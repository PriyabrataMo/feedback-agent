import json

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import JSONResponse

from ..storage import storage_for

# Dashboard data + dev playback. No auth yet, so these are 404 in production; dashboard auth
# (docs/architecture.md) replaces this guard.
router = APIRouter(prefix="/api/v1")


def _dev_only(request: Request) -> None:
    if request.app.state.settings.is_production:
        raise HTTPException(404)


@router.get("/admin/sessions")
async def list_sessions(request: Request):
    _dev_only(request)
    return [s.to_api() for s in request.app.state.store.list()]


@router.get("/admin/sessions/{session_id}")
async def session_detail(session_id: str, request: Request):
    _dev_only(request)
    session = request.app.state.store.get(session_id)
    if session is None:
        raise HTTPException(404)
    storage = storage_for(request.app.state.local_storage, session.project_id)
    media = await storage.list(f"{session.prefix}/media")
    events = await storage.list(f"{session.prefix}/events")
    return {**session.to_api(), "mediaChunks": len(media), "replaySegments": len(events)}


@router.get("/admin/sessions/{session_id}/events")
async def session_events(session_id: str, request: Request):
    """
    Dashboard replay: the rrweb events of every stored NDJSON segment, concatenated in segment order
    as one JSON array (empty when nothing was recorded). The dashboard fetches this straight from the
    browser, so the Origin is reflected for allow-listed project origins only (dev-only like its siblings).
    """
    _dev_only(request)
    session = request.app.state.store.get(session_id)
    if session is None:
        raise HTTPException(404)
    storage = storage_for(request.app.state.local_storage, session.project_id)
    events: list[dict] = []
    for key in await storage.list(f"{session.prefix}/events"):
        body = await storage.get_object(key)
        for line in (body or b"").decode("utf-8", errors="replace").splitlines():
            if not line.strip():
                continue
            try:
                event = json.loads(line)
            except ValueError:
                continue  # a corrupt line must not break the whole replay
            if isinstance(event, dict):
                events.append(event)
    headers = {"Cache-Control": "no-store", "Vary": "Origin"}
    origin = request.headers.get("origin")
    if origin and origin in request.app.state.projects.all_origins():
        headers["Access-Control-Allow-Origin"] = origin
    return JSONResponse(events, headers=headers)


@router.get("/sessions/{session_id}/media")
async def stitched_media(session_id: str, request: Request):
    """
    Dashboard playback: stitches the per-chunk objects back into one stream. MediaRecorder chunks
    from a single recording concatenate byte-for-byte into a valid file. Production playback uses a
    worker-finalised object behind a presigned GET.
    """
    _dev_only(request)
    session = request.app.state.store.get(session_id)
    if session is None:
        raise HTTPException(404)
    storage = storage_for(request.app.state.local_storage, session.project_id)
    keys = await storage.list(f"{session.prefix}/media")
    if not keys:
        raise HTTPException(404, "no media")
    parts = [await storage.get_object(k) for k in keys]
    data = b"".join(p for p in parts if p is not None)
    return Response(data, media_type="video/mp4" if keys[0].endswith(".mp4") else "video/webm")
