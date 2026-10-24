import json
import secrets
import sqlite3
import threading
from datetime import UTC, datetime, timedelta
from typing import Literal

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

SessionStatus = Literal["active", "ended", "abandoned"]


class Session(BaseModel):
    """Serialised with camelCase aliases: this shape is the SDK/dashboard contract."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    id: str
    project_id: str
    status: SessionStatus
    url: str
    user_agent: str
    end_user: dict | None
    realtime_provider: str
    started_at: str
    ended_at: str | None
    # Object-storage prefix; everything for this session lives under it.
    prefix: str
    transcript: list[dict]
    context: dict | None
    # Summed provider token usage by modality, reported by the SDK at session end.
    usage: dict | None

    def to_api(self) -> dict:
        return self.model_dump(by_alias=True)


def new_session_id() -> str:
    return f"ses_{secrets.token_hex(8)}"


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


_SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    status TEXT NOT NULL,
    url TEXT NOT NULL,
    user_agent TEXT NOT NULL,
    end_user TEXT,
    realtime_provider TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    prefix TEXT NOT NULL,
    transcript TEXT NOT NULL,
    context TEXT,
    usage TEXT
);
CREATE INDEX IF NOT EXISTS sessions_project_started ON sessions (project_id, started_at);
"""


def _loads(value: str | None):
    return None if value is None else json.loads(value)


def _row_to_session(row: sqlite3.Row) -> Session:
    return Session(
        id=row["id"],
        project_id=row["project_id"],
        status=row["status"],
        url=row["url"],
        user_agent=row["user_agent"],
        end_user=_loads(row["end_user"]),
        realtime_provider=row["realtime_provider"],
        started_at=row["started_at"],
        ended_at=row["ended_at"],
        prefix=row["prefix"],
        transcript=json.loads(row["transcript"]),
        context=_loads(row["context"]),
        usage=_loads(row["usage"]),
    )


class SessionStore:
    """
    Dev store on stdlib sqlite3 (one file). Calls are sync and microsecond-scale, so they run inline
    on the event loop; the Postgres version (asyncpg/SQLAlchemy) makes them awaitable.
    """

    def __init__(self, path: str):
        self._db = sqlite3.connect(path, check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        self._lock = threading.Lock()
        with self._lock:
            self._db.executescript(_SCHEMA)

    def create(
        self,
        *,
        id: str,
        project_id: str,
        url: str,
        user_agent: str,
        end_user: dict | None,
        realtime_provider: str,
        prefix: str,
    ) -> Session:
        session = Session(
            id=id,
            project_id=project_id,
            status="active",
            url=url,
            user_agent=user_agent,
            end_user=end_user,
            realtime_provider=realtime_provider,
            started_at=_now(),
            ended_at=None,
            prefix=prefix,
            transcript=[],
            context=None,
            usage=None,
        )
        with self._lock, self._db:
            self._db.execute(
                "INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    session.id,
                    session.project_id,
                    session.status,
                    session.url,
                    session.user_agent,
                    json.dumps(session.end_user) if session.end_user is not None else None,
                    session.realtime_provider,
                    session.started_at,
                    None,
                    session.prefix,
                    "[]",
                    None,
                    None,
                ),
            )
        return session

    def get(self, id: str) -> Session | None:
        with self._lock:
            row = self._db.execute("SELECT * FROM sessions WHERE id = ?", (id,)).fetchone()
        return _row_to_session(row) if row else None

    def list(self) -> list[Session]:
        with self._lock:
            rows = self._db.execute("SELECT * FROM sessions ORDER BY started_at DESC").fetchall()
        return [_row_to_session(r) for r in rows]

    def recent_count(self, project_id: str, since: timedelta) -> int:
        cutoff = (datetime.now(UTC) - since).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        with self._lock:
            row = self._db.execute(
                "SELECT COUNT(*) FROM sessions WHERE project_id = ? AND started_at >= ?",
                (project_id, cutoff),
            ).fetchone()
        return row[0]

    def end(self, id: str, *, transcript: list[dict], context: dict | None, usage: dict | None) -> Session | None:
        with self._lock, self._db:
            cur = self._db.execute(
                "UPDATE sessions SET status='ended', ended_at=?, transcript=?, context=?, usage=? WHERE id=?",
                (
                    _now(),
                    json.dumps(transcript),
                    json.dumps(context) if context is not None else None,
                    json.dumps(usage) if usage is not None else None,
                    id,
                ),
            )
        return self.get(id) if cur.rowcount else None
