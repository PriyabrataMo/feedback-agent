from dataclasses import dataclass


@dataclass(frozen=True)
class Project:
    id: str
    public_key: str
    # Origins (scheme + host + port) allowed to create sessions. Enforced server-side.
    allowed_origins: tuple[str, ...]
    max_session_seconds: int
    # Hard cap so an exposed public key can't burn the model budget.
    max_sessions_per_hour: int


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


def dev_registry() -> ProjectRegistry:
    return ProjectRegistry(
        [
            Project(
                id="proj_dev",
                public_key="pk_dev_demo",
                allowed_origins=("http://localhost:3000", "http://127.0.0.1:3000"),
                max_session_seconds=180,
                max_sessions_per_hour=30,
            )
        ]
    )
