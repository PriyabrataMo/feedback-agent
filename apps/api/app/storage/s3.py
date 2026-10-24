import asyncio
import threading
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

from .base import StorageProvider

# Refresh assumed-role credentials this long before they expire, so every presigned URL we mint
# (they die with the credentials that signed them) stays valid for at least this long.
_REFRESH_MARGIN_SEC = 15 * 60
_ASSUME_ROLE_DURATION_SEC = 3600  # AWS minimum for role chaining is 900; 3600 is the default max for chained roles.


@dataclass(frozen=True)
class ByobConfig:
    """
    Per-project bring-your-own-bucket settings. Never global, never logged.
    `external_id` is the confused-deputy guard: the customer's role trust policy requires it.
    """

    bucket: str
    region: str
    role_arn: str
    external_id: str
    # Prefix the customer's role is scoped to (e.g. "feedback-agent"); applied to every key.
    key_prefix: str = ""
    # S3-compatible stores only (MinIO, R2); AWS S3 leaves this unset.
    endpoint_url: str | None = None

    def __repr__(self) -> str:  # keep the ExternalId out of logs and tracebacks
        return f"ByobConfig(bucket={self.bucket!r}, region={self.region!r}, role_arn={self.role_arn!r}, external_id='***')"


class _AssumedRoleClient:
    """Caches an S3 client built from STS AssumeRole credentials and rebuilds it before they expire."""

    def __init__(self, byob: ByobConfig, *, sts_client_factory: Callable[[], Any] | None = None):
        self._byob = byob
        self._sts_factory = sts_client_factory or (
            lambda: boto3.client("sts", region_name=byob.region, endpoint_url=None)
        )
        self._lock = threading.Lock()
        self._client: Any = None
        self._expires_at: float = 0.0

    def get(self) -> Any:
        with self._lock:
            if self._client is None or time.time() >= self._expires_at - _REFRESH_MARGIN_SEC:
                self._client, self._expires_at = self._build()
            return self._client

    def _build(self) -> tuple[Any, float]:
        resp = self._sts_factory().assume_role(
            RoleArn=self._byob.role_arn,
            RoleSessionName=f"feedback-agent-{uuid.uuid4().hex[:12]}",
            ExternalId=self._byob.external_id,
            DurationSeconds=_ASSUME_ROLE_DURATION_SEC,
        )
        creds = resp["Credentials"]
        expiry = creds["Expiration"]
        expires_at = expiry.timestamp() if isinstance(expiry, datetime) else datetime.now(UTC).timestamp() + 900
        client = _make_s3_client(
            region=self._byob.region,
            endpoint_url=self._byob.endpoint_url,
            access_key=creds["AccessKeyId"],
            secret_key=creds["SecretAccessKey"],
            session_token=creds["SessionToken"],
        )
        return client, expires_at


def _make_s3_client(
    *,
    region: str | None,
    endpoint_url: str | None,
    access_key: str | None = None,
    secret_key: str | None = None,
    session_token: str | None = None,
) -> Any:
    cfg = Config(
        signature_version="s3v4",
        # Path style for S3-compatible endpoints (MinIO/localstack); virtual-hosted on AWS.
        s3={"addressing_style": "path" if endpoint_url else "virtual"},
        retries={"max_attempts": 3, "mode": "standard"},
    )
    kwargs: dict[str, Any] = {"region_name": region, "endpoint_url": endpoint_url, "config": cfg}
    if access_key:
        kwargs.update(
            aws_access_key_id=access_key, aws_secret_access_key=secret_key, aws_session_token=session_token
        )
    return boto3.client("s3", **kwargs)


def _friendly_error(e: Exception) -> str:
    """Short, user-facing diagnostic. Never includes credentials (botocore errors don't carry them)."""
    if isinstance(e, ClientError):
        err = e.response.get("Error", {})
        code, msg = err.get("Code", "Unknown"), err.get("Message", "")
        op = e.operation_name
        hints = {
            "NoSuchBucket": "bucket does not exist (check name and region)",
            "AccessDenied": "access denied (check the role/bucket policy and key prefix)",
            "InvalidAccessKeyId": "invalid credentials",
            "SignatureDoesNotMatch": "invalid credentials",
        }
        if op == "AssumeRole" and code == "AccessDenied":
            return "AssumeRole denied: check the role's trust policy (our account id and ExternalId)"
        return f"{op} failed: {code}" + (f" - {hints[code]}" if code in hints else f" - {msg}" if msg else "")
    if isinstance(e, BotoCoreError):
        return f"S3 connection error: {e}"
    return str(e)


class S3Storage(StorageProvider):
    """
    AWS S3 (or S3-compatible) adapter. Used for managed mode (our bucket, default credential chain)
    and BYOB mode (customer bucket, via STS AssumeRole + ExternalId).

    boto3 is synchronous, so every call runs in a worker thread. The client is resolved inside
    that thread too, so a lazy AssumeRole never blocks the event loop.
    """

    def __init__(self, bucket: str, client_provider: Callable[[], Any], *, key_prefix: str = ""):
        self.bucket = bucket
        self._client_provider = client_provider
        self._prefix = key_prefix.strip("/")

    # --- constructors -------------------------------------------------------------------------

    @classmethod
    def managed(
        cls, bucket: str, *, region: str | None = None, endpoint_url: str | None = None, key_prefix: str = ""
    ) -> "S3Storage":
        client = _make_s3_client(region=region, endpoint_url=endpoint_url)
        return cls(bucket, lambda: client, key_prefix=key_prefix)

    @classmethod
    def byob(cls, cfg: ByobConfig, *, sts_client_factory: Callable[[], Any] | None = None) -> "S3Storage":
        holder = _AssumedRoleClient(cfg, sts_client_factory=sts_client_factory)
        return cls(cfg.bucket, holder.get, key_prefix=cfg.key_prefix)

    # --- helpers ------------------------------------------------------------------------------

    def _full(self, key: str) -> str:
        if not key or key.startswith("/") or ".." in key.split("/"):
            raise ValueError("invalid storage key")
        return f"{self._prefix}/{key}" if self._prefix else key

    def _strip(self, full_key: str) -> str:
        return full_key[len(self._prefix) + 1 :] if self._prefix else full_key

    # --- StorageProvider ----------------------------------------------------------------------

    async def presign_put(self, key: str, *, content_type: str, expires_in_sec: int) -> str:
        # ContentType is signed: the browser PUT must send exactly this Content-Type header,
        # otherwise S3 answers SignatureDoesNotMatch. The SDK already sends the value it asked for.
        full = self._full(key)

        def run() -> str:
            return self._client_provider().generate_presigned_url(
                "put_object",
                Params={"Bucket": self.bucket, "Key": full, "ContentType": content_type},
                ExpiresIn=expires_in_sec,
                HttpMethod="PUT",
            )

        return await asyncio.to_thread(run)

    async def presign_get(self, key: str, *, expires_in_sec: int) -> str:
        full = self._full(key)

        def run() -> str:
            return self._client_provider().generate_presigned_url(
                "get_object", Params={"Bucket": self.bucket, "Key": full}, ExpiresIn=expires_in_sec
            )

        return await asyncio.to_thread(run)

    async def put_object(self, key: str, body: bytes, content_type: str) -> None:
        full = self._full(key)
        await asyncio.to_thread(
            lambda: self._client_provider().put_object(
                Bucket=self.bucket, Key=full, Body=body, ContentType=content_type
            )
        )

    async def get_object(self, key: str) -> bytes | None:
        full = self._full(key)

        def run() -> bytes | None:
            try:
                return self._client_provider().get_object(Bucket=self.bucket, Key=full)["Body"].read()
            except ClientError as e:
                if e.response.get("Error", {}).get("Code") in ("NoSuchKey", "404"):
                    return None
                raise

        return await asyncio.to_thread(run)

    async def list(self, prefix: str) -> list[str]:
        full_prefix = self._full(prefix) if prefix else self._prefix
        # Directory semantics (matches LocalStorage): "a/b" lists "a/b/...", not "a/bc/...".
        if full_prefix and not full_prefix.endswith("/"):
            full_prefix += "/"

        def run() -> list[str]:
            client = self._client_provider()
            keys: list[str] = []
            for page in client.get_paginator("list_objects_v2").paginate(Bucket=self.bucket, Prefix=full_prefix):
                keys.extend(obj["Key"] for obj in page.get("Contents", []))
            return keys

        return sorted(self._strip(k) for k in await asyncio.to_thread(run))

    async def delete(self, key: str) -> None:
        full = self._full(key)
        await asyncio.to_thread(lambda: self._client_provider().delete_object(Bucket=self.bucket, Key=full))

    async def test_connection(self) -> tuple[bool, str | None]:
        """Probe write, read and delete; returns a short diagnostic that never contains credentials."""
        key = f"_probe/{int(time.time() * 1000)}-{uuid.uuid4().hex[:8]}"
        try:
            await self.put_object(key, b"\x01", "application/octet-stream")
            if await self.get_object(key) != b"\x01":
                return False, "read-back of probe object failed"
            await self.delete(key)
            return True, None
        except Exception as e:  # noqa: BLE001 - surfaced to the user as a diagnostic string
            return False, _friendly_error(e)
