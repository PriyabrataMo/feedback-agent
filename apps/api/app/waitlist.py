"""
Landing-page waitlist: email validation, sqlite storage (same DB file as sessions) and an in-process
rate limiter. HTTP wiring lives in routes/waitlist.py.
"""

import csv
import hashlib
import hmac
import io
import re
import sqlite3
import threading
import time
from collections import deque
from dataclasses import dataclass
from datetime import UTC, datetime

MAX_EMAIL_LENGTH = 254  # RFC 5321 path limit
MAX_LOCAL_LENGTH = 64
MAX_SOURCE_LENGTH = 64

# Deliberately lightweight (no email-validator dependency): ASCII dot-atom local part, a dotted
# domain of LDH labels and an alphabetic TLD. IDN domains must arrive in punycode form.
_EMAIL_RE = re.compile(
    r"^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*"
    r"@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$"
)


def has_control_chars(value: str) -> bool:
    return any(ord(c) < 32 or ord(c) == 127 for c in value)


def normalize_email(raw: object) -> str | None:
    """Stripped + lowercased address, or None if it isn't a plausible email. Never raises."""
    if not isinstance(raw, str):
        return None
    email = raw.strip().lower()
    if not email or len(email) > MAX_EMAIL_LENGTH or has_control_chars(email):
        return None
    if not _EMAIL_RE.match(email) or len(email.partition("@")[0]) > MAX_LOCAL_LENGTH:
        return None
    return email


def clean_source(raw: object) -> str | None:
    """Free-text attribution tag (e.g. "hero", "footer"): control chars dropped, truncated."""
    if not isinstance(raw, str):
        return None
    cleaned = "".join(c for c in raw if not (ord(c) < 32 or ord(c) == 127)).strip()
    return cleaned[:MAX_SOURCE_LENGTH] or None


def mask_email(email: str) -> str:
    """a***@d***.com: enough to correlate log lines without writing the address itself."""
    local, _, domain = email.partition("@")
    host, _, tld = domain.rpartition(".")
    return f"{local[:1]}***@{host[:1]}***.{tld}"


def hash_ip(ip: str, salt: str) -> str:
    """Salted (HMAC-SHA256) hash of the client IP. The raw IP is never stored or logged."""
    return hmac.new(salt.encode(), ip.encode(), hashlib.sha256).hexdigest()[:32]


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


_SCHEMA = """
CREATE TABLE IF NOT EXISTS waitlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    source TEXT,
    created_at TEXT NOT NULL,
    ip_hash TEXT
);
CREATE INDEX IF NOT EXISTS waitlist_created ON waitlist (created_at);
"""


@dataclass(frozen=True)
class WaitlistEntry:
    id: int
    email: str
    source: str | None
    created_at: str
    ip_hash: str | None

    def to_api(self) -> dict:
        return {
            "id": self.id,
            "email": self.email,
            "source": self.source,
            "createdAt": self.created_at,
            "ipHash": self.ip_hash,
        }


class WaitlistStore:
    """
    A `waitlist` table in the sessions sqlite file, on its own connection (SessionStore keeps its
    connection private). Created idempotently at construction. sqlite is only durable if the file
    sits on a persistent volume (DATA_DIR).
    """

    def __init__(self, path: str):
        self._db = sqlite3.connect(path, check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        self._lock = threading.Lock()
        with self._lock:
            self._db.executescript(_SCHEMA)

    def add(self, *, email: str, source: str | None, ip_hash: str | None) -> bool:
        """INSERT OR IGNORE: True when a new row was stored, False for an already-registered email."""
        with self._lock, self._db:
            cur = self._db.execute(
                "INSERT OR IGNORE INTO waitlist (email, source, created_at, ip_hash) VALUES (?,?,?,?)",
                (email, source, _now(), ip_hash),
            )
        return cur.rowcount > 0

    def list(self) -> list[WaitlistEntry]:
        """Newest first."""
        with self._lock:
            rows = self._db.execute(
                "SELECT * FROM waitlist ORDER BY created_at DESC, id DESC"
            ).fetchall()
        return [
            WaitlistEntry(r["id"], r["email"], r["source"], r["created_at"], r["ip_hash"])
            for r in rows
        ]

    def count(self) -> int:
        with self._lock:
            return self._db.execute("SELECT COUNT(*) FROM waitlist").fetchone()[0]


class RateLimiter:
    """
    Sliding-window limiter keyed by ip_hash: `per_minute` requests per 60s and `per_day` per 24h,
    plus one global per-minute bucket so a client rotating a spoofed X-Forwarded-For can't flood us.

    LIMITATION: state is in this process's memory. It is only correct for a single instance (or a
    single worker); with N instances the effective limit is N times higher, and a restart resets
    it. Move to Redis (or the DB) before scaling out.
    """

    _MAX_KEYS = 50_000  # memory bound: stale keys are pruned, then the oldest dropped

    def __init__(
        self,
        per_minute: int = 5,
        per_day: int = 30,
        global_per_minute: int = 300,
        clock=time.monotonic,
    ):
        self._per_minute, self._per_day, self._global = per_minute, per_day, global_per_minute
        self._clock = clock
        self._hits: dict[str, deque[float]] = {}
        self._all: deque[float] = deque()
        self._lock = threading.Lock()

    def allow(self, key: str) -> bool:
        now = self._clock()
        with self._lock:
            while self._all and now - self._all[0] >= 60:
                self._all.popleft()
            if len(self._all) >= self._global:
                return False
            hits = self._hits.setdefault(key, deque())
            while hits and now - hits[0] >= 86_400:
                hits.popleft()
            if (
                len(hits) >= self._per_day
                or sum(1 for t in hits if now - t < 60) >= self._per_minute
            ):
                return False
            hits.append(now)
            self._all.append(now)
            if len(self._hits) > self._MAX_KEYS:
                self._prune(now)
            return True

    def _prune(self, now: float) -> None:
        for k in [k for k, h in self._hits.items() if not h or now - h[-1] >= 86_400]:
            del self._hits[k]
        while len(self._hits) > self._MAX_KEYS:
            del self._hits[next(iter(self._hits))]


_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def csv_cell(value: object) -> str:
    """Spreadsheet formula-injection guard: a cell that would be read as a formula gets a leading '."""
    text = "" if value is None else str(value)
    return "'" + text if text.startswith(_FORMULA_PREFIXES) else text


def entries_to_csv(entries: list[WaitlistEntry]) -> str:
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\r\n")
    writer.writerow(["id", "email", "source", "created_at", "ip_hash"])
    for e in entries:
        writer.writerow(
            [e.id, csv_cell(e.email), csv_cell(e.source), e.created_at, e.ip_hash or ""]
        )
    return out.getvalue()
