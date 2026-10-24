"""TicketSink protocol, the neutral ticket draft sinks receive, and the shared retry helper."""

import asyncio
import random
from collections.abc import Awaitable, Callable
from dataclasses import asdict, dataclass, field
from typing import Protocol, TypeVar

import httpx

T = TypeVar("T")

SEVERITIES = ("low", "medium", "high", "critical")


class TicketError(Exception):
    """A sink failure. `retryable` = transient (network, 5xx, 429); `message` must never contain secrets."""

    def __init__(self, message: str, *, retryable: bool = False, retry_after: float | None = None, auth: bool = False):
        super().__init__(message)
        self.message = message
        self.auth = auth  # credentials rejected: retrying or looking up can't help
        self.retryable = retryable
        self.retry_after = retry_after


@dataclass
class TicketDraft:
    """Sink-neutral ticket. `idempotency_key` is stable per session so sinks can dedupe retries."""

    project_id: str
    session_id: str
    idempotency_key: str
    title: str
    body_markdown: str
    summary: str
    repro_steps: list[str]
    severity: str
    area: str
    page_url: str
    recording_url: str
    source: str  # "llm" | "fallback": how the summary was produced
    labels: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> "TicketDraft":
        return cls(**data)


@dataclass
class TicketResult:
    external_id: str
    url: str | None = None


class TicketSink(Protocol):
    """
    One tracker. `create` must be idempotent per `draft.idempotency_key`: a retried job (after a
    timeout, a crash, or a restart) must return the existing ticket, never create a second one.
    Raise TicketError on failure. (`comment`/`link`/`test_connection` from docs/architecture.md come with dedupe.)
    """

    kind: str

    async def create(self, draft: TicketDraft) -> TicketResult: ...


def is_retryable_status(status: int) -> bool:
    return status in (408, 425, 429) or status >= 500


def parse_retry_after(response: httpx.Response) -> float | None:
    try:
        return max(0.0, float(response.headers.get("retry-after", "")))
    except ValueError:
        return None


async def retry_async(
    op: Callable[[], Awaitable[T]],
    *,
    attempts: int,
    base_delay: float,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    before_retry: Callable[[], Awaitable[T | None]] | None = None,
    max_delay: float = 30.0,
) -> T:
    """
    Run `op`, retrying retryable TicketErrors with exponential backoff + jitter (honouring Retry-After).
    `before_retry` runs ahead of each retry and may return a result to stop early: sinks use it to check
    "did my previous, ambiguous attempt actually land?" so a timeout never leads to a duplicate.
    """
    for attempt in range(max(attempts, 1)):
        try:
            return await op()
        except TicketError as exc:
            if not exc.retryable or attempt >= attempts - 1:
                raise
            delay = exc.retry_after if exc.retry_after is not None else base_delay * (2**attempt)
            await sleep(min(delay, max_delay) * (0.75 + random.random() * 0.5) if base_delay else 0)
            if before_retry is not None:
                try:
                    if (found := await before_retry()) is not None:
                        return found
                except TicketError as check_error:
                    if check_error.auth:
                        raise
                    # The check itself failed; try the real op again (sinks keep that safe via deterministic ids).
    raise AssertionError("unreachable")  # pragma: no cover
