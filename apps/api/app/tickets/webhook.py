"""
Generic signed webhook sink. POSTs the draft as JSON; the receiver verifies an HMAC-SHA256 signature.

Headers:
  X-Feedback-Timestamp:       unix seconds when signed
  X-Feedback-Signature:       "sha256=" + hex(HMAC_SHA256(secret, f"{timestamp}.{raw_body}"))
  X-Feedback-Idempotency-Key: stable per session; dedupe on it (we retry on timeouts / 5xx)
Receivers should reject timestamps older than a few minutes (replay protection) and compare in constant time.
"""

import asyncio
import hashlib
import hmac
import json
import time
from collections.abc import Awaitable, Callable
from urllib.parse import urlsplit

import httpx

from .base import (
    TicketDraft,
    TicketError,
    TicketResult,
    is_retryable_status,
    parse_retry_after,
    retry_async,
)

_LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}


def sign(secret: str, timestamp: str, body: bytes) -> str:
    mac = hmac.new(secret.encode(), timestamp.encode() + b"." + body, hashlib.sha256)
    return "sha256=" + mac.hexdigest()


def validate_webhook_url(url: str) -> None:
    parts = urlsplit(url)
    local = (parts.hostname or "") in _LOCAL_HOSTS
    if (
        parts.scheme not in ("http", "https")
        or not parts.hostname
        or (parts.scheme == "http" and not local)
    ):
        raise TicketError("webhook url must be https (http only for localhost)")


class WebhookSink:
    kind = "webhook"

    def __init__(
        self,
        *,
        url: str,
        secret: str,
        client: httpx.AsyncClient,
        attempts: int = 3,
        base_delay: float = 1.0,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        clock: Callable[[], float] = time.time,
    ):
        validate_webhook_url(url)
        self._url, self._secret, self._client = url, secret, client
        self._attempts, self._base_delay, self._sleep, self._clock = (
            attempts,
            base_delay,
            sleep,
            clock,
        )

    def build_request(self, draft: TicketDraft) -> tuple[bytes, dict[str, str]]:
        payload = {"event": "ticket.requested", "version": 1, "ticket": draft.to_dict()}
        body = json.dumps(
            payload, separators=(",", ":"), sort_keys=True, ensure_ascii=False
        ).encode()
        timestamp = str(int(self._clock()))
        headers = {
            "Content-Type": "application/json",
            "X-Feedback-Timestamp": timestamp,
            "X-Feedback-Signature": sign(self._secret, timestamp, body),
            "X-Feedback-Idempotency-Key": draft.idempotency_key,
        }
        return body, headers

    async def create(self, draft: TicketDraft) -> TicketResult:
        async def attempt() -> TicketResult:
            body, headers = self.build_request(draft)  # re-signed per attempt: fresh timestamp
            try:
                response = await self._client.post(self._url, content=body, headers=headers)
            except httpx.HTTPError as exc:
                raise TicketError(
                    f"webhook request failed: {type(exc).__name__}", retryable=True
                ) from None
            if response.status_code >= 400:
                raise TicketError(
                    f"webhook returned HTTP {response.status_code}",
                    retryable=is_retryable_status(response.status_code),
                    retry_after=parse_retry_after(response),
                )
            external_id, url = draft.idempotency_key, None
            try:
                data = response.json()
                if isinstance(data, dict):
                    external_id = str(data.get("id") or external_id)[:200]
                    candidate = data.get("url")
                    url = (
                        candidate
                        if isinstance(candidate, str)
                        and candidate.startswith(("http://", "https://"))
                        else None
                    )
            except ValueError:
                pass  # receivers may answer 204 / plain text
            return TicketResult(external_id=external_id, url=url)

        return await retry_async(
            attempt, attempts=self._attempts, base_delay=self._base_delay, sleep=self._sleep
        )
