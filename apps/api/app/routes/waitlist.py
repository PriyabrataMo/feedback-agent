import hmac
import logging

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, Response

from ..http import ApiError, parse_json, read_body
from ..waitlist import (
    clean_source,
    entries_to_csv,
    hash_ip,
    mask_email,
    normalize_email,
)

log = logging.getLogger("showbug_api.waitlist")

router = APIRouter()

MAX_WAITLIST_BODY_BYTES = 4_096


def client_ip(request: Request) -> str:
    """
    First X-Forwarded-For entry (the Next.js proxy forwards the visitor's IP), else the socket peer.
    The header is client-controlled unless a trusted proxy overwrites it; the limiter's global
    bucket bounds the damage if it is spoofed.
    """
    forwarded = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    if forwarded:
        return forwarded[:64]
    return request.client.host if request.client else "unknown"


@router.post("/v1/waitlist")
async def join_waitlist(request: Request):
    """
    Always `200 {"ok": true}` for a valid email, new or already registered, so the response never
    reveals whether an address is on the list. 422 invalid email, 429 rate limited.
    """
    state = request.app.state
    ip_hash = hash_ip(client_ip(request), state.settings.waitlist_ip_salt)
    if not state.waitlist_limiter.allow(ip_hash):
        return JSONResponse(
            {"error": "rate_limited"}, status_code=429, headers={"Retry-After": "60"}
        )

    try:
        body = parse_json(await read_body(request, MAX_WAITLIST_BODY_BYTES))
    except ValueError:
        body = None
    if not isinstance(body, dict):
        raise ApiError(422, "invalid_email")

    # Honeypot: a hidden field real visitors never fill. Look successful, store nothing.
    website = body.get("website")
    if website and str(website).strip():
        return {"ok": True}

    email = normalize_email(body.get("email"))
    if email is None:
        raise ApiError(422, "invalid_email")

    source = clean_source(body.get("source"))
    if state.waitlist.add(email=email, source=source, ip_hash=ip_hash):
        log.info("waitlist signup %s source=%s", mask_email(email), source)
    return {"ok": True}


def require_admin(request: Request) -> None:
    """
    Owner-only: `Authorization: Bearer <WAITLIST_ADMIN_TOKEN>`. Unlike the dev-only dashboard routes
    in admin.py these must work in production, so a token is required in every environment; with no
    token configured the endpoints are disabled (404) instead of open.
    """
    token = request.app.state.settings.waitlist_admin_token
    if not token:
        raise HTTPException(404)
    scheme, _, supplied = request.headers.get("authorization", "").partition(" ")
    if scheme.lower() != "bearer" or not hmac.compare_digest(
        supplied.strip().encode(), token.encode()
    ):
        raise HTTPException(401, "unauthorized", headers={"WWW-Authenticate": "Bearer"})


@router.get("/admin/waitlist")
async def list_waitlist(request: Request):
    require_admin(request)
    entries = request.app.state.waitlist.list()
    return JSONResponse(
        {"count": len(entries), "entries": [e.to_api() for e in entries]},
        headers={"Cache-Control": "no-store"},
    )


@router.get("/admin/waitlist.csv")
async def waitlist_csv(request: Request):
    require_admin(request)
    entries = request.app.state.waitlist.list()
    return Response(
        entries_to_csv(entries),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": 'attachment; filename="waitlist.csv"',
            "Cache-Control": "no-store",
        },
    )
