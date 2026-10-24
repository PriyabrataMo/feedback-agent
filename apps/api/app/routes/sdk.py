import json
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Request

from ..http import ApiError, as_int, authenticate_sdk, jsend, read_json
from ..realtime import AGENT_INSTRUCTIONS
from ..sessions import Session, new_session_id
from ..storage import storage_for

router = APIRouter(prefix="/api/v1/sessions")

# Grace after the session cap so the final chunks still upload.
GRACE = timedelta(seconds=60)
MAX_EVENTS_BODY_BYTES = 1_000_000
MAX_SEQ = 100_000


def _clip(value: object, n: int) -> list:
    return value[-n:] if isinstance(value, list) else []


def clean_usage(value: object, depth: int = 0) -> dict | None:
    """Keeps only finite numbers in a small nested object; the client is untrusted."""
    if not isinstance(value, dict) or depth > 3:
        return None
    out: dict = {}
    for k, v in list(value.items())[:30]:
        key = str(k)[:40]
        if isinstance(v, (int, float)) and not isinstance(v, bool) and v == v and abs(v) != float("inf"):
            out[key] = v
        elif (child := clean_usage(v, depth + 1)) is not None:
            out[key] = child
    return out


def _clean_user(value: object) -> dict | None:
    if not isinstance(value, dict):
        return None
    return {k: str(value[k])[:200] for k in ("userId", "accountId", "plan") if isinstance(value.get(k), (str, int))}


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

    if state.store.recent_count(project.id, timedelta(hours=1)) >= project.max_sessions_per_hour:
        raise ApiError(429, "rate_limited", origin)

    body = await read_json(request)
    session_id = new_session_id()

    try:
        client = await state.realtime.create_client_session(instructions=AGENT_INSTRUCTIONS)
    except Exception:  # noqa: BLE001 - provider failure must not leak details to the browser
        request.app.state.log.exception("realtime provider failed")
        raise ApiError(502, "realtime_unavailable", origin) from None

    state.store.create(
        id=session_id,
        project_id=project.id,
        url=str(body.get("url") or "")[:2048],
        user_agent=request.headers.get("user-agent", "")[:512],
        end_user=_clean_user(body.get("user")),
        realtime_provider=client.provider,
        prefix=f"{project.id}/{session_id}",
    )
    return jsend(
        {"sessionId": session_id, "maxSessionSeconds": project.max_session_seconds, "realtime": client.to_api()},
        201,
        origin,
    )


@router.post("/{session_id}/upload-url")
async def upload_url(session_id: str, request: Request):
    auth = authenticate_sdk(request)
    project, origin = auth.project, auth.origin
    session = _owned_session(request, session_id, project.id, origin)

    deadline = datetime.fromisoformat(session.started_at) + timedelta(seconds=project.max_session_seconds) + GRACE
    if datetime.now(UTC) > deadline:
        raise ApiError(410, "session_expired", origin)

    body = await read_json(request)
    seq = as_int(body.get("seq"))
    if seq is None or not 0 <= seq <= MAX_SEQ:
        raise ApiError(400, "bad_seq", origin)

    content_type = body.get("contentType") if isinstance(body.get("contentType"), str) else None
    ext = "mp4" if content_type and "mp4" in content_type else "webm"
    # One object per MediaRecorder chunk (avoids S3's 5 MB multipart minimum; the worker stitches them).
    key = f"{session.prefix}/media/{seq:06d}.{ext}"
    storage = storage_for(request.app.state.local_storage, project.id)
    url = await storage.presign_put(key, content_type=content_type or "video/webm", expires_in_sec=300)
    return jsend({"url": url, "key": key}, 200, origin)


@router.post("/{session_id}/events")
async def ingest_events(session_id: str, request: Request):
    auth = authenticate_sdk(request)
    project, origin = auth.project, auth.origin
    session = _owned_session(request, session_id, project.id, origin)

    raw = await request.body()
    if len(raw) > MAX_EVENTS_BODY_BYTES:
        raise ApiError(413, "too_large", origin)
    try:
        parsed = json.loads(raw)
    except ValueError:
        raise ApiError(400, "bad_json", origin) from None

    seq = as_int(parsed.get("seq")) if isinstance(parsed, dict) else None
    events = parsed.get("events") if isinstance(parsed, dict) else None
    if not isinstance(events, list) or seq is None or not 0 <= seq <= MAX_SEQ:
        raise ApiError(400, "bad_request", origin)

    # rrweb events stored as NDJSON segments; Postgres will only hold pointers.
    ndjson = "\n".join(json.dumps(e, separators=(",", ":"), ensure_ascii=False) for e in events)
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
    context = (
        {
            "consoleErrors": _clip(raw_ctx.get("consoleErrors"), 50),
            "failedRequests": _clip(raw_ctx.get("failedRequests"), 50),
            "clicks": _clip(raw_ctx.get("clicks"), 10),
        }
        if isinstance(raw_ctx, dict)
        else None
    )

    request.app.state.store.end(session_id, transcript=transcript, context=context, usage=clean_usage(body.get("usage")))
    # TODO(worker): enqueue session.ended -> summarize, dedupe, create ticket via TicketSink.
    return jsend({"ok": True}, 200, origin)


def _number(value: object) -> float | int:
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) and value == value else 0
