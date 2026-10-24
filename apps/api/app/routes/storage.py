from fastapi import APIRouter, Request, Response

from ..http import cors_headers

router = APIRouter(prefix="/api/v1/storage")

MAX_OBJECT_BYTES = 8_000_000

# Dev stand-in for an S3 presigned endpoint: the signature in the query string is the only auth,
# exactly like a real presigned URL. Not mounted in production (S3/GCS URLs replace it).


def _guard(request: Request, key: str, method: str) -> Response | None:
    if request.app.state.settings.is_production:
        return Response("not found", status_code=404)
    q = request.query_params
    try:
        exp = int(q.get("exp", ""))
    except ValueError:
        return Response("forbidden", status_code=403)
    if not request.app.state.local_storage.verify_signature(key, method, exp, q.get("sig", "")):
        return Response("forbidden", status_code=403)
    return None


@router.put("/{key:path}")
async def put_object(key: str, request: Request):
    if denied := _guard(request, key, "PUT"):
        return denied
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_OBJECT_BYTES:
        return Response("too large", status_code=413)
    body = await request.body()
    if len(body) > MAX_OBJECT_BYTES:
        return Response("too large", status_code=413)
    await request.app.state.local_storage.put_object(
        key, body, request.headers.get("content-type", "application/octet-stream")
    )
    return Response(status_code=200, headers=cors_headers(request.headers.get("origin")))


@router.get("/{key:path}")
async def get_object(key: str, request: Request):
    if denied := _guard(request, key, "GET"):
        return denied
    obj = await request.app.state.local_storage.get_object(key)
    if obj is None:
        return Response("not found", status_code=404)
    return Response(obj, media_type="application/octet-stream")
