from dataclasses import dataclass

from fastapi import Request
from fastapi.responses import JSONResponse

from .projects import Project


def cors_headers(origin: str | None) -> dict[str, str]:
    """CORS for the public SDK endpoints: the Origin is reflected only after an allow-list check."""
    return {
        "Access-Control-Allow-Origin": origin or "",
        "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Public-Key",
        "Access-Control-Max-Age": "600",
        "Vary": "Origin",
    }


def jsend(body: object, status: int, origin: str | None) -> JSONResponse:
    return JSONResponse(body, status_code=status, headers=cors_headers(origin) if origin else None)


class ApiError(Exception):
    def __init__(self, status: int, code: str, origin: str | None = None):
        self.status, self.code, self.origin = status, code, origin


@dataclass
class Authed:
    project: Project
    origin: str


def authenticate_sdk(request: Request) -> Authed:
    """
    Public-key auth + server-side origin allow-list. The SDK can be tampered with, so this is the
    real gate (docs/architecture.md "Abuse"). Failures carry no CORS headers on purpose.
    """
    origin = request.headers.get("origin")
    project = request.app.state.projects.by_public_key(request.headers.get("x-public-key"))
    if project is None:
        raise ApiError(401, "invalid_key")
    if not origin or origin not in project.allowed_origins:
        raise ApiError(403, "origin_not_allowed")
    return Authed(project, origin)


async def read_json(request: Request) -> dict:
    """Lenient body parse: anything that isn't a JSON object becomes {} and fails field validation."""
    try:
        body = await request.json()
    except ValueError:
        return {}
    return body if isinstance(body, dict) else {}


def as_int(value: object) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None
