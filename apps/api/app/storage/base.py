from abc import ABC, abstractmethod


class StorageProvider(ABC):
    """
    Cloud-agnostic object storage. One adapter per cloud (local-disk for dev, S3 next, then GCS);
    the rest of the system never sees cloud specifics. See docs/architecture.md "Storage modes".

    The browser uploads media straight to the bucket via presigned PUT URLs, so media bytes
    never pass through our servers (managed and BYOB alike).
    """

    @abstractmethod
    async def presign_put(self, key: str, *, content_type: str, expires_in_sec: int) -> str:
        """Short-lived URL the browser can PUT one object to."""

    @abstractmethod
    async def presign_get(self, key: str, *, expires_in_sec: int) -> str:
        """Short-lived URL the dashboard can GET an object from."""

    @abstractmethod
    async def put_object(self, key: str, body: bytes, content_type: str) -> None:
        """Server-side write (used for small event segments the API receives)."""

    @abstractmethod
    async def get_object(self, key: str) -> bytes | None: ...

    @abstractmethod
    async def list(self, prefix: str) -> list[str]:
        """Keys under a prefix, sorted ascending."""

    @abstractmethod
    async def delete(self, key: str) -> None: ...

    async def test_connection(self) -> tuple[bool, str | None]:
        """Write, read and delete a probe object. Used by the BYOB onboarding "Test connection" button."""
        import time

        key = f"_probe/{int(time.time() * 1000)}"
        try:
            await self.put_object(key, b"\x01", "application/octet-stream")
            if await self.get_object(key) is None:
                raise RuntimeError("read-back failed")
            await self.delete(key)
            return True, None
        except Exception as e:  # noqa: BLE001 - surfaced to the user as a diagnostic string
            return False, str(e)
