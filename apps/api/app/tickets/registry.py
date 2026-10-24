"""Maps a project's SinkConfig to a TicketSink. Add a tracker = write a sink + register a factory here."""

import asyncio
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass, field

import httpx

from ..projects import SinkConfig
from .base import TicketError, TicketSink
from .linear import LinearSink
from .webhook import WebhookSink


@dataclass
class SinkRuntime:
    """Process-wide plumbing handed to every sink: shared HTTP client, env for secrets, retry policy."""

    client: httpx.AsyncClient
    env: Mapping[str, str]
    attempts: int = 3
    base_delay: float = 1.0
    sleep: Callable[[float], Awaitable[None]] = field(default=asyncio.sleep)


def _secret(config: SinkConfig, runtime: SinkRuntime, default_env: str) -> str:
    name = config.secret_env or default_env
    value = runtime.env.get(name)
    if not value:
        raise TicketError(f"{name} is not set")  # the NAME only; never a value
    return value


def _linear(config: SinkConfig, runtime: SinkRuntime) -> TicketSink:
    team_id = config.options.get("team_id")
    if not team_id:
        raise TicketError("linear sink needs team_id")
    return LinearSink(
        api_key=_secret(config, runtime, "LINEAR_API_KEY"),
        team_id=str(team_id),
        label_ids=[str(x) for x in config.options.get("label_ids") or []],
        client=runtime.client,
        attempts=runtime.attempts,
        base_delay=runtime.base_delay,
        sleep=runtime.sleep,
    )


def _webhook(config: SinkConfig, runtime: SinkRuntime) -> TicketSink:
    url = config.options.get("url")
    if not url:
        raise TicketError("webhook sink needs url")
    return WebhookSink(
        url=str(url),
        secret=_secret(config, runtime, "TICKET_WEBHOOK_SECRET"),
        client=runtime.client,
        attempts=runtime.attempts,
        base_delay=runtime.base_delay,
        sleep=runtime.sleep,
    )


FACTORIES: dict[str, Callable[[SinkConfig, SinkRuntime], TicketSink]] = {
    "linear": _linear,
    "webhook": _webhook,
}


def build_sink(config: SinkConfig, runtime: SinkRuntime) -> TicketSink:
    factory = FACTORIES.get(config.kind)
    if factory is None:
        raise TicketError(f"unknown ticket sink '{config.kind}'")
    return factory(config, runtime)
