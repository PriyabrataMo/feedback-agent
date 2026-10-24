import os
from dataclasses import dataclass, field


@dataclass(frozen=True)
class SinkConfig:
    """
    Where a project's tickets go. Holds no secrets: `secret_env` is the NAME of the environment
    variable with the API key / signing secret (the Postgres version stores an encrypted-secret ref).
    """

    kind: str  # "linear" | "webhook"; see app/tickets/registry.py
    options: dict = field(default_factory=dict)  # linear: team_id, label_ids; webhook: url
    secret_env: str | None = None


@dataclass(frozen=True)
class Project:
    id: str
    public_key: str
    # Origins (scheme + host + port) allowed to create sessions. Enforced server-side.
    allowed_origins: tuple[str, ...]
    max_session_seconds: int
    # Hard cap so an exposed public key can't burn the model budget.
    max_sessions_per_hour: int
    # None = no tracker configured; sessions are recorded but no ticket is created.
    ticket_sink: SinkConfig | None = None


class ProjectRegistry:
    """Dev-only project table. Becomes the `projects` Postgres table (docs/architecture.md data model)."""

    def __init__(self, projects: list[Project]):
        self._projects = projects

    def by_public_key(self, public_key: str | None) -> Project | None:
        return next((p for p in self._projects if p.public_key == public_key), None)

    def by_id(self, project_id: str) -> Project | None:
        return next((p for p in self._projects if p.id == project_id), None)

    def all_origins(self) -> set[str]:
        return {o for p in self._projects for o in p.allowed_origins}


def _dev_sink_from_env() -> SinkConfig | None:
    """Dev convenience: pick the sink from env. LINEAR_API_KEY+LINEAR_TEAM_ID wins over TICKET_WEBHOOK_URL."""
    if os.environ.get("LINEAR_API_KEY") and os.environ.get("LINEAR_TEAM_ID"):
        labels = [x.strip() for x in os.environ.get("LINEAR_LABEL_IDS", "").split(",") if x.strip()]
        return SinkConfig(
            "linear",
            {"team_id": os.environ["LINEAR_TEAM_ID"], "label_ids": labels},
            secret_env="LINEAR_API_KEY",
        )
    if os.environ.get("TICKET_WEBHOOK_URL"):
        return SinkConfig(
            "webhook", {"url": os.environ["TICKET_WEBHOOK_URL"]}, secret_env="TICKET_WEBHOOK_SECRET"
        )
    return None


def dev_registry() -> ProjectRegistry:
    return ProjectRegistry(
        [
            Project(
                id="proj_dev",
                public_key="pk_dev_demo",
                allowed_origins=("http://localhost:3000", "http://127.0.0.1:3000"),
                max_session_seconds=180,
                max_sessions_per_hour=30,
                ticket_sink=_dev_sink_from_env(),
            )
        ]
    )
