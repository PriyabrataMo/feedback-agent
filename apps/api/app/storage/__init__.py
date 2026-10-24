import threading

from ..config import Settings
from .base import StorageProvider
from .local import LocalStorage
from .s3 import ByobConfig, S3Storage

__all__ = ["ByobConfig", "LocalStorage", "S3Storage", "StorageConfigError", "StorageProvider", "storage_for"]


class StorageConfigError(RuntimeError):
    """Storage is misconfigured (e.g. STORAGE_BACKEND=s3 without S3_BUCKET)."""


_lock = threading.Lock()
_settings: Settings | None = None
_managed: dict[tuple, S3Storage] = {}
_byob: dict[ByobConfig, S3Storage] = {}


def reset_storage_cache() -> None:
    """Forget cached settings and S3 clients (tests, or after changing env)."""
    global _settings
    with _lock:
        _settings = None
        _managed.clear()
        _byob.clear()


def storage_for(
    local: LocalStorage,
    project_id: str,
    *,
    byob: ByobConfig | None = None,
    settings: Settings | None = None,
) -> StorageProvider:
    """
    Resolves the storage backend for a project.

    - `byob` given (per-project config, from the projects table): S3 in the customer's bucket via
      STS AssumeRole + ExternalId, regardless of STORAGE_BACKEND.
    - else STORAGE_BACKEND=s3: our managed bucket (S3_BUCKET / S3_REGION / S3_ENDPOINT_URL).
    - else (default `local`): the dev disk adapter.

    S3 adapters are cached so boto3 clients and assumed-role credentials are reused across requests.
    GCS slots in here later.
    """
    global _settings
    with _lock:
        if byob is not None:
            if byob not in _byob:
                _byob[byob] = S3Storage.byob(byob)
            return _byob[byob]

        if settings is None:
            if _settings is None:
                _settings = Settings.from_env()
            settings = _settings

        if settings.storage_backend == "local":
            return local
        if settings.storage_backend != "s3":
            raise StorageConfigError(f"unknown STORAGE_BACKEND {settings.storage_backend!r} (use 'local' or 's3')")

        cfg = settings.s3
        if not cfg.bucket:
            raise StorageConfigError("STORAGE_BACKEND=s3 requires S3_BUCKET")
        cache_key = (cfg.bucket, cfg.region, cfg.endpoint_url, cfg.key_prefix)
        if cache_key not in _managed:
            _managed[cache_key] = S3Storage.managed(
                cfg.bucket, region=cfg.region, endpoint_url=cfg.endpoint_url, key_prefix=cfg.key_prefix
            )
        return _managed[cache_key]
