import asyncio
import hashlib
import hmac
import time
from pathlib import Path

from .base import StorageProvider


class LocalStorage(StorageProvider):
    """Dev adapter: objects on local disk, URLs signed with an HMAC (mimics S3 query-string auth)."""

    def __init__(self, root: Path, secret: str):
        self.root = root.resolve()
        self._secret = secret.encode()

    def _sign(self, key: str, method: str, exp: int) -> str:
        return hmac.new(self._secret, f"{method}:{key}:{exp}".encode(), hashlib.sha256).hexdigest()

    def verify_signature(self, key: str, method: str, exp: int, sig: str) -> bool:
        if exp < time.time():
            return False
        return hmac.compare_digest(self._sign(key, method, exp), sig)

    def _resolve(self, key: str) -> Path:
        full = (self.root / key).resolve()
        if full != self.root and self.root not in full.parents:
            raise ValueError("invalid storage key")
        return full

    async def presign_put(self, key: str, *, content_type: str, expires_in_sec: int) -> str:
        exp = int(time.time()) + expires_in_sec
        return f"/api/v1/storage/{key}?exp={exp}&sig={self._sign(key, 'PUT', exp)}"

    async def presign_get(self, key: str, *, expires_in_sec: int) -> str:
        exp = int(time.time()) + expires_in_sec
        return f"/api/v1/storage/{key}?exp={exp}&sig={self._sign(key, 'GET', exp)}"

    async def put_object(self, key: str, body: bytes, content_type: str) -> None:
        path = self._resolve(key)

        def write() -> None:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(body)

        await asyncio.to_thread(write)

    async def get_object(self, key: str) -> bytes | None:
        path = self._resolve(key)
        try:
            return await asyncio.to_thread(path.read_bytes)
        except (FileNotFoundError, IsADirectoryError):
            return None

    async def list(self, prefix: str) -> list[str]:
        base = self._resolve(prefix)
        files = await asyncio.to_thread(
            lambda: [p for p in base.rglob("*") if p.is_file()] if base.is_dir() else []
        )
        return sorted(p.relative_to(self.root).as_posix() for p in files)

    async def delete(self, key: str) -> None:
        await asyncio.to_thread(lambda: self._resolve(key).unlink(missing_ok=True))
