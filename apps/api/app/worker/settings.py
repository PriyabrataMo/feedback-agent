import os
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass, field


@dataclass
class TicketSettings:
    """
    Worker config, read from env here (not config.py) so the ticket pipeline stays self-contained.
    Secrets (LINEAR_API_KEY, TICKET_WEBHOOK_SECRET, ...) are looked up in `env` at ticket time by the
    name each project's SinkConfig points to; they are never stored on a Project.
    """

    # Base URL of the dashboard; the ticket links to {base}/dashboard/{session_id}. Placeholder until deployed.
    dashboard_base_url: str = "http://localhost:3000"
    openai_api_key: str | None = None
    openai_base_url: str = "https://api.openai.com/v1"
    summary_model: str = "gpt-4o-mini"
    summary_timeout: float = 30.0
    workers: int = 2
    retry_attempts: int = 3
    retry_base_delay: float = 1.0
    env: Mapping[str, str] = field(default_factory=lambda: os.environ)
    sleep: Callable[[float], Awaitable[None]] | None = None  # tests inject a no-op

    def recording_url(self, session_id: str) -> str:
        return f"{self.dashboard_base_url.rstrip('/')}/dashboard/{session_id}"

    @classmethod
    def from_env(cls, *, openai_api_key: str | None) -> "TicketSettings":
        e = os.environ
        return cls(
            dashboard_base_url=e.get("DASHBOARD_BASE_URL", cls.dashboard_base_url),
            openai_api_key=openai_api_key,
            openai_base_url=e.get("OPENAI_BASE_URL", cls.openai_base_url),
            summary_model=e.get("TICKET_SUMMARY_MODEL", cls.summary_model),
            workers=int(e.get("TICKET_WORKERS", cls.workers)),
        )
