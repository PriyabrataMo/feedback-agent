import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

API_ROOT = Path(__file__).resolve().parent.parent  # apps/api


@dataclass(frozen=True)
class S3Config:
    """
    Managed-mode S3 settings (our bucket). Credentials are NOT config: boto3's default chain
    (env vars, shared profile, instance/task role) supplies them. BYOB role ARN + ExternalId are
    per project, not global (see storage.s3.ByobConfig).
    """

    bucket: str | None = None
    region: str | None = None
    # Set for S3-compatible stores (MinIO, R2, localstack). Switches to path-style addressing.
    endpoint_url: str | None = None
    # Optional prefix inside the managed bucket (keys already carry the tenant prefix).
    key_prefix: str = ""


@dataclass
class Settings:
    data_dir: Path = field(default_factory=lambda: API_ROOT / ".data")
    environment: str = "development"
    # HMAC secret for the dev-only signed storage URLs.
    dev_storage_secret: str = "dev-only-secret"
    openai_api_key: str | None = None
    realtime_model: str = "gpt-realtime"
    realtime_voice: str = "marin"
    # "local" (dev disk) or "s3" (managed bucket; BYOB projects always use S3).
    storage_backend: str = "local"
    s3: S3Config = field(default_factory=S3Config)

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @classmethod
    def from_env(cls) -> "Settings":
        load_dotenv(API_ROOT / ".env")
        return cls(
            data_dir=Path(os.environ.get("DATA_DIR", API_ROOT / ".data")),
            environment=os.environ.get("APP_ENV", "development"),
            dev_storage_secret=os.environ.get("DEV_STORAGE_SECRET", "dev-only-secret"),
            openai_api_key=os.environ.get("OPENAI_API_KEY") or None,
            realtime_model=os.environ.get("REALTIME_MODEL", "gpt-realtime"),
            realtime_voice=os.environ.get("REALTIME_VOICE", "marin"),
            storage_backend=(os.environ.get("STORAGE_BACKEND") or "local").strip().lower(),
            s3=S3Config(
                bucket=os.environ.get("S3_BUCKET") or None,
                region=os.environ.get("S3_REGION") or None,
                endpoint_url=os.environ.get("S3_ENDPOINT_URL") or None,
                key_prefix=(os.environ.get("S3_KEY_PREFIX") or "").strip("/"),
            ),
        )
