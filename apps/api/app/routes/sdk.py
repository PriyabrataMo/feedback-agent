import asyncio
import json
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Request

from ..http import (
    ApiError,
    as_int,
    authenticate_sdk,
    jsend,
    parse_json,
    read_body,
    read_json,
)
from ..realtime import AGENT_INSTRUCTIONS
from ..sessions import Session, new_session_id
from ..storage import storage_for

router = APIRouter(prefix="/api/v1/sessions")

# Grace after the session cap so the final chunks still upload.
GRACE = timedelta(seconds=60)
MAX_EVENTS_BODY_BYTES = 1_000_000
MAX_SEQ = 100_000


_quota_locks: dict[str, asyncio.Lock] = {}


def _quota_lock(project_id: str) -> asyncio.Lock:
    return _quota_locks.setdefault(project_id, asyncio.Lock())


def _clip(value: object, n: int) -> list:
    return value[-n:] if isinstance(value, list) else []


def clean_usage(value: object, depth: int = 0) -> dict | None:
    """Keeps only finite numbers in a small nested object; the client is untrusted."""
    if not isinstance(value, dict) or depth > 3:
        return None
    out: dict = {}
    for k, v in list(value.items())[:30]:
        key = str(k)[:40]
        if (
            isinstance(v, (int, float))
            and not isinstance(v, bool)
            and v == v
            and abs(v) != float("inf")
        ):
            out[key] = v
        elif (child := clean_usage(v, depth + 1)) is not None:
            out[key] = child
    return out


def _clean_user(value: object) -> dict | None:
    if not isinstance(value, dict):
        return None
    return {
        k: str(value[k])[:200]
        for k in ("userId", "accountId", "plan")
        if isinstance(value.get(k), (str, int))
    }


def _owned_session(request: Request, session_id: str, project_id: str, origin: str) -> Session:
    session = request.app.state.store.get(session_id)
    if session is None or session.project_id != project_id:
        raise ApiError(404, "not_found", origin)
    return session


@router.post("")
async def create_session(request: Request):
    auth = authenticate_sdk(request)
    project, origin = auth.project, auth.origin
    state = request.app.state

    body = await read_json(request)
    session_id = new_session_id()

    # Reserve the quota slot (a row) before the slow provider call, under a lock, so concurrent
    # creates can't all pass the check. A provider failure releases the slot.
    async with _quota_lock(project.id):
        if (
            state.store.recent_count(project.id, timedelta(hours=1))
            >= project.max_sessions_per_hour
        ):
            raise ApiError(429, "rate_limited", origin)
        state.store.create(
            id=session_id,
            project_id=project.id,
            url=str(body.get("url") or "")[:2048],
            user_agent=request.headers.get("user-agent", "")[:512],
            end_user=_clean_user(body.get("user")),
            realtime_provider=state.realtime.name,
            prefix=f"{project.id}/{session_id}",
        )

    try:
        client = await state.realtime.create_client_session(instructions=AGENT_INSTRUCTIONS)
    except Exception:
        request.app.state.log.exception("realtime provider failed")
        state.store.delete(session_id)
        raise ApiError(502, "realtime_unavailable", origin) from None
    return jsend(
        {
            "sessionId": session_id,
            "maxSessionSeconds": project.max_session_seconds,
            "realtime": client.to_api(),
        },
        201,
        origin,
    )


@router.post("/{session_id}/upload-url")
async def upload_url(session_id: str, request: Request):
    auth = authenticate_sdk(request)
    project, origin = auth.project, auth.origin
    session = _owned_session(request, session_id, project.id, origin)

    deadline = (
        datetime.fromisoformat(session.started_at)
        + timedelta(seconds=project.max_session_seconds)
        + GRACE
    )
    if datetime.now(UTC) > deadline:
        raise ApiError(410, "session_expired", origin)

    body = await read_json(request)
    seq = as_int(body.get("seq"))
    if seq is None or not 0 <= seq <= MAX_SEQ:
        raise ApiError(400, "bad_seq", origin)

    # Never sign a client-chosen type (a text/html object would be stored XSS on the bucket origin).
    requested_value = body.get("contentType")
    requested = requested_value if isinstance(requested_value, str) else ""
    ext = "mp4" if "mp4" in requested else "webm"
    content_type = f"video/{ext}"
    # One object per MediaRecorder chunk (avoids S3's 5 MB multipart minimum; the worker stitches them).
    key = f"{session.prefix}/media/{seq:06d}.{ext}"
    storage = storage_for(request.app.state.local_storage, project.id)
    url = await storage.presign_put(key, content_type=content_type, expires_in_sec=300)
    # Content-Type is a signed header on S3: the browser must send exactly this value (not the
    # recorder's "video/webm;codecs=..."), or S3 answers SignatureDoesNotMatch.
    return jsend({"url": url, "key": key, "headers": {"Content-Type": content_type}}, 200, origin)


@router.post("/{session_id}/events")
async def ingest_events(session_id: str, request: Request):
    auth = authenticate_sdk(request)
    project, origin = auth.project, auth.origin
    session = _owned_session(request, session_id, project.id, origin)

    raw = await read_body(request, MAX_EVENTS_BODY_BYTES)
    try:
        parsed = parse_json(raw)
    except ValueError:
        raise ApiError(400, "bad_json", origin) from None

    seq = as_int(parsed.get("seq")) if isinstance(parsed, dict) else None
    events = parsed.get("events") if isinstance(parsed, dict) else None
    if not isinstance(events, list) or seq is None or not 0 <= seq <= MAX_SEQ:
        raise ApiError(400, "bad_request", origin)

    # rrweb events stored as NDJSON segments; Postgres will only hold pointers.
    ndjson = "\n".join(
        json.dumps(e, separators=(",", ":")) for e in events
    )  # ASCII-escaped: lone surrogates are safe
    key = f"{session.prefix}/events/{seq:06d}.ndjson"
    storage = storage_for(request.app.state.local_storage, project.id)
    await storage.put_object(key, ndjson.encode(), "application/x-ndjson")
    return jsend({"ok": True}, 200, origin)


@router.post("/{session_id}/end")
async def end_session(session_id: str, request: Request):
    auth = authenticate_sdk(request)
    project, origin = auth.project, auth.origin
    _owned_session(request, session_id, project.id, origin)

    body = await read_json(request)
    transcript = [
        {
            "role": "agent" if t.get("role") == "agent" else "user",
            "text": str(t.get("text") or "")[:4000],
            "at": _number(t.get("at")),
        }
        for t in _clip(body.get("transcript"), 200)
        if isinstance(t, dict)
    ]
    raw_ctx = body.get("context")
    console_logs = (
        _clean_console_entries(raw_ctx.get("consoleLogs"), 100) if isinstance(raw_ctx, dict) else []
    )
    network_requests = (
        _clean_network_entries(raw_ctx.get("networkRequests"), 100)
        if isinstance(raw_ctx, dict)
        else []
    )
    context = (
        {
            "consoleLogs": console_logs,
            "networkRequests": network_requests,
            "consoleErrors": _clean_console_entries(raw_ctx.get("consoleErrors"), 50)
            or [entry for entry in console_logs if entry["level"] not in {"debug", "log", "info"}][
                -50:
            ],
            "failedRequests": _clean_network_entries(raw_ctx.get("failedRequests"), 50)
            or [
                entry
                for entry in network_requests
                if entry["status"] == 0 or entry["status"] >= 400
            ][-50:],
            "clicks": _clip(raw_ctx.get("clicks"), 10),
            "navigations": _clean_navigations(raw_ctx.get("navigations")),
        }
        if isinstance(raw_ctx, dict)
        else None
    )

    request.app.state.store.end(
        session_id, transcript=transcript, context=context, usage=clean_usage(body.get("usage"))
    )
    request.app.state.worker.enqueue(
        session_id
    )  # never raises; ticket failures don't affect this response
    return jsend({"ok": True}, 200, origin)


def _clean_console_entries(value: object, limit: int) -> list[dict]:
    """Re-shape bounded browser console entries; captured text is untrusted."""
    out = []
    for entry in _clip(value, limit):
        if isinstance(entry, dict):
            out.append(
                {
                    "level": str(entry.get("level") or "log")[:20],
                    "message": str(entry.get("message") or "")[:1000],
                    "at": _number(entry.get("at")),
                }
            )
    return out


def _clean_network_entries(value: object, limit: int) -> list[dict]:
    """Keep diagnostic request metadata only—never headers, query strings or bodies."""
    out = []
    for entry in _clip(value, limit):
        if not isinstance(entry, dict):
            continue
        status = as_int(entry.get("status"))
        duration = _number(entry.get("durationMs"))
        # Defence in depth if a modified SDK submits a raw URL. Fragments never reach an HTTP server and
        # query values commonly contain credentials or PII, so neither belongs in diagnostics.
        url = str(entry.get("url") or "").split("#", 1)[0].split("?", 1)[0][:300]
        out.append(
            {
                "type": "xhr" if entry.get("type") == "xhr" else "fetch",
                "method": str(entry.get("method") or "GET").upper()[:10],
                "url": url,
                "status": status if status is not None and 0 <= status <= 999 else 0,
                "durationMs": max(0, min(duration, 3_600_000)),
                "at": _number(entry.get("at")),
            }
        )
    return out


def _clean_navigations(value: object) -> list[dict]:
    """SPA route changes from the SDK (already URL-masked client-side); the client is untrusted, so re-shape and clip."""
    out = []
    for n in _clip(value, 30):
        if isinstance(n, dict):
            out.append(
                {
                    "url": str(n.get("url") or "")[:2048],
                    "from": str(n.get("from") or "")[:2048],
                    "title": str(n.get("title") or "")[:300],
                    "at": _number(n.get("at")),
                }
            )
    return out


def _number(value: object) -> float | int:
    return (
        value
        if isinstance(value, (int, float)) and not isinstance(value, bool) and value == value
        else 0
    )
