import time

from . import ClientSession


class MockProvider:
    """
    Used when no provider key is configured. The browser side greets with speechSynthesis and ends on
    the Done button, which lets capture, upload and ticket plumbing be tested end to end without a key.
    """

    name = "mock"

    async def create_client_session(self, *, instructions: str) -> ClientSession:
        return ClientSession(
            provider="mock",
            model="mock",
            client_secret="",
            expires_at=int(time.time()) + 300,
            connect_url="",
            instructions=instructions,
        )
