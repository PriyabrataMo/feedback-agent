import json
import secrets
import sqlite3
import threading
from datetime import UTC, datetime, timedelta
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

SessionStatus = Literal["active", "ended", "abandoned"]
# pending: queued; creating: claimed by a worker; created/failed: terminal; skipped: project has no sink.
TicketStatus = Literal["pending", "creating", "created", "failed", "skipped"]


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
    # Ticket pipeline state (app/worker). All None until the session ends.
    ticket_status: TicketStatus | None = None
    ticket_url: str | None = None
    ticket_external_id: str | None = None
    # Short, secret-free reason for the last failure; shown on the dashboard.
    ticket_error: str | None = None
    summary: str | None = None
    repro_steps: list[str] | None = None
    # The full rendered draft, kept so a retry never re-bills the LLM. Internal: not in the API shape.
    ticket_draft: dict | None = Field(default=None, exclude=True)

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


# Columns added after the first release. Existing .data/sessions.db files get them via ALTER TABLE.
_TICKET_COLUMNS = {
    "ticket_status": "TEXT",
    "ticket_url": "TEXT",
    "ticket_external_id": "TEXT",
    "ticket_error": "TEXT",
    "summary": "TEXT",
    "repro_steps": "TEXT",
    "ticket_draft": "TEXT",
}
_TICKET_JSON = {"repro_steps", "ticket_draft"}


def _migrate(db: sqlite3.Connection) -> None:
    have = {row[1] for row in db.execute("PRAGMA table_info(sessions)")}
    for name, sql_type in _TICKET_COLUMNS.items():  # names are constants above, never user input
        if name not in have:
            db.execute(f"ALTER TABLE sessions ADD COLUMN {name} {sql_type}")


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
        ticket_status=row["ticket_status"],
        ticket_url=row["ticket_url"],
        ticket_external_id=row["ticket_external_id"],
        ticket_error=row["ticket_error"],
        summary=row["summary"],
        repro_steps=_loads(row["repro_steps"]),
        ticket_draft=_loads(row["ticket_draft"]),
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
            with self._db:
                _migrate(self._db)

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
                "INSERT INTO sessions (id, project_id, status, url, user_agent, end_user, realtime_provider,"
                " started_at, ended_at, prefix, transcript, context, usage) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
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

    # --- ticket pipeline -------------------------------------------------------------------------

    def mark_ticket_pending(self, id: str) -> bool:
        """Queue a session for ticketing. A no-op (False) if a ticket is already queued, running or created."""
        with self._lock, self._db:
            cur = self._db.execute(
                "UPDATE sessions SET ticket_status='pending', ticket_error=NULL WHERE id=? AND status='ended'"
                " AND (ticket_status IS NULL OR ticket_status IN ('failed','skipped'))",
                (id,),
            )
        return cur.rowcount > 0

    def claim_ticket(self, id: str) -> bool:
        """Atomically move pending/failed -> creating. Exactly one caller wins, so a job never runs twice."""
        with self._lock, self._db:
            cur = self._db.execute(
                "UPDATE sessions SET ticket_status='creating', ticket_error=NULL WHERE id=?"
                " AND ticket_status IN ('pending','failed')",
                (id,),
            )
        return cur.rowcount > 0

    def set_ticket(self, id: str, **fields: object) -> None:
        unknown = set(fields) - set(_TICKET_COLUMNS)
        if unknown:
            raise ValueError(f"unknown ticket fields: {sorted(unknown)}")
        if not fields:
            return
        values = [json.dumps(v) if k in _TICKET_JSON and v is not None else v for k, v in fields.items()]
        assignments = ", ".join(f"{k}=?" for k in fields)  # keys validated against _TICKET_COLUMNS above
        with self._lock, self._db:
            self._db.execute(f"UPDATE sessions SET {assignments} WHERE id=?", (*values, id))

    def requeue_interrupted_tickets(self) -> list[str]:
        """After a restart: creating -> pending (the sink is idempotent), return ids that still need a ticket."""
        with self._lock, self._db:
            self._db.execute("UPDATE sessions SET ticket_status='pending' WHERE ticket_status='creating'")
            rows = self._db.execute(
                "SELECT id FROM sessions WHERE status='ended' AND ticket_status='pending' ORDER BY ended_at"
            ).fetchall()
        return [r["id"] for r in rows]
