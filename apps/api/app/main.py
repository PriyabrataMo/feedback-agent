import logging
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse

from .config import Settings
from .http import ApiError, cors_headers
from .projects import ProjectRegistry, dev_registry
from .realtime import RealtimeProvider
from .realtime.mock import MockProvider
from .realtime.openai import OpenAIProvider
from .routes import admin, sdk, storage
from .sessions import SessionStore
from .storage import LocalStorage


def create_app(
    settings: Settings | None = None,
    *,
    projects: ProjectRegistry | None = None,
    realtime: RealtimeProvider | None = None,
) -> FastAPI:
    settings = settings or Settings.from_env()
    http_client = httpx.AsyncClient(timeout=15)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        yield
        await http_client.aclose()

    app = FastAPI(title="Feedback Agent API", lifespan=lifespan)
    settings.data_dir.mkdir(parents=True, exist_ok=True)

    app.state.settings = settings
    app.state.log = logging.getLogger("feedback_api")
    app.state.projects = projects or dev_registry()
    app.state.store = SessionStore(str(settings.data_dir / "sessions.db"))
    app.state.local_storage = LocalStorage(settings.data_dir / "objects", settings.dev_storage_secret)
    if realtime is not None:
        app.state.realtime = realtime
    elif settings.openai_api_key:
        app.state.realtime = OpenAIProvider(
            settings.openai_api_key, settings.realtime_model, settings.realtime_voice, http_client
        )
    else:
        app.state.realtime = MockProvider()

    @app.exception_handler(ApiError)
    async def api_error(_: Request, exc: ApiError):
        return JSONResponse({"error": exc.code}, status_code=exc.status, headers=cors_headers(exc.origin) if exc.origin else None)

    @app.middleware("http")
    async def preflight(request: Request, call_next):
        # The public key isn't available on a preflight, so allow any origin some project allows;
        # the real gate (key + origin) runs on the actual request.
        if request.method == "OPTIONS" and request.url.path.startswith("/api/v1/"):
            origin = request.headers.get("origin")
            allowed = origin if origin in app.state.projects.all_origins() else None
            return Response(status_code=204, headers=cors_headers(allowed))
        return await call_next(request)

    @app.get("/healthz")
    async def healthz():
        return {"ok": True, "realtime": app.state.realtime.__class__.__name__}

    app.include_router(sdk.router)
    app.include_router(storage.router)
    app.include_router(admin.router)
    return app

