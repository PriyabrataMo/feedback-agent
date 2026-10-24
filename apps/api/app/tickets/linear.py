"""
Linear sink: GraphQL `issueCreate` over httpx.

Idempotency: Linear lets the client choose the new issue's UUID (`IssueCreateInput.id`). We derive it
deterministically from the draft's idempotency key, so a duplicate create can never produce a second
issue. After any ambiguous failure (timeout, 5xx) we first look the issue up by that id and return it
if the earlier attempt landed.
"""

import asyncio
import hashlib
import uuid
from collections.abc import Awaitable, Callable

import httpx

from .base import TicketDraft, TicketError, TicketResult, is_retryable_status, parse_retry_after, retry_async

LINEAR_URL = "https://api.linear.app/graphql"

# Linear priorities: 0 none, 1 urgent, 2 high, 3 medium, 4 low.
_PRIORITY = {"critical": 1, "high": 2, "medium": 3, "low": 4}
_MAX_DESCRIPTION = 60_000

_CREATE = """
mutation IssueCreate($input: IssueCreateInput!) {
  issueCreate(input: $input) { success issue { id identifier url } }
}
"""
_LOOKUP = "query IssueLookup($id: String!) { issue(id: $id) { id identifier url } }"


def issue_uuid(idempotency_key: str) -> str:
    """Deterministic v4-formatted UUID (Linear expects v4 format) from the idempotency key."""
    digest = hashlib.sha256(f"linear-issue:{idempotency_key}".encode()).digest()
    return str(uuid.UUID(bytes=digest[:16], version=4))


class LinearSink:
    kind = "linear"

    def __init__(
        self,
        *,
        api_key: str,
        team_id: str,
        client: httpx.AsyncClient,
        label_ids: list[str] | None = None,
        attempts: int = 3,
        base_delay: float = 1.0,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        url: str = LINEAR_URL,
    ):
        self._team_id = team_id
        self._label_ids = label_ids or []
        self._client = client
        self._attempts, self._base_delay, self._sleep, self._url = attempts, base_delay, sleep, url
        # Personal API keys go in the header as-is; OAuth access tokens need "Bearer".
        self._auth = f"Bearer {api_key}" if api_key.startswith("lin_oauth_") else api_key

    async def create(self, draft: TicketDraft) -> TicketResult:
        issue_id = issue_uuid(draft.idempotency_key)

        async def attempt() -> TicketResult:
            try:
                return await self._create(issue_id, draft)
            except TicketError as exc:
                if not exc.retryable and not exc.auth:
                    # e.g. "id already exists" after a lost response: if it's ours, we're done.
                    try:
                        if (existing := await self._lookup(issue_id)) is not None:
                            return existing
                    except TicketError:
                        pass
                raise

        return await retry_async(
            attempt,
            attempts=self._attempts,
            base_delay=self._base_delay,
            sleep=self._sleep,
            before_retry=lambda: self._lookup(issue_id),
        )

    async def _create(self, issue_id: str, draft: TicketDraft) -> TicketResult:
        issue_input: dict = {
            "id": issue_id,
            "teamId": self._team_id,
            "title": draft.title,
            "description": draft.body_markdown[:_MAX_DESCRIPTION],
            "priority": _PRIORITY.get(draft.severity, 0),
        }
        if self._label_ids:
            issue_input["labelIds"] = self._label_ids
        data = await self._graphql(_CREATE, {"input": issue_input})
        payload = data.get("issueCreate") or {}
        issue = payload.get("issue")
        if not payload.get("success") or not isinstance(issue, dict):
            raise TicketError("Linear issueCreate reported failure")
        return _result(issue)

    async def _lookup(self, issue_id: str) -> TicketResult | None:
        try:
            data = await self._graphql(_LOOKUP, {"id": issue_id})
        except TicketError as exc:
            if exc.retryable or exc.auth:
                raise
            return None  # GraphQL "entity not found" -> the earlier attempt didn't land
        issue = data.get("issue")
        return _result(issue) if isinstance(issue, dict) else None

    async def _graphql(self, query: str, variables: dict) -> dict:
        try:
            response = await self._client.post(
                self._url,
                json={"query": query, "variables": variables},
                headers={"Authorization": self._auth, "Content-Type": "application/json"},
            )
        except httpx.HTTPError as exc:  # timeouts, connection resets: the request may or may not have landed
            raise TicketError(f"Linear request failed: {type(exc).__name__}", retryable=True) from None

        body: dict = {}
        try:
            parsed = response.json()
            body = parsed if isinstance(parsed, dict) else {}
        except ValueError:
            pass
        errors = body.get("errors") if isinstance(body.get("errors"), list) else []
        messages = "; ".join(str(e.get("message", ""))[:150] for e in errors if isinstance(e, dict))[:300]
        rate_limited = any(
            isinstance(e, dict) and isinstance(e.get("extensions"), dict) and e["extensions"].get("code") == "RATELIMITED"
            for e in errors
        )

        if response.status_code in (401, 403):
            raise TicketError(f"Linear rejected the API key (HTTP {response.status_code})", auth=True)
        if rate_limited or is_retryable_status(response.status_code):
            raise TicketError(
                f"Linear unavailable or rate limited (HTTP {response.status_code})",
                retryable=True,
                retry_after=parse_retry_after(response),
            )
        if response.status_code >= 400 or errors:
            raise TicketError(f"Linear error (HTTP {response.status_code}): {messages or 'no detail'}")
        data = body.get("data")
        if not isinstance(data, dict):
            raise TicketError("Linear returned no data")
        return data


def _result(issue: dict) -> TicketResult:
    return TicketResult(external_id=str(issue.get("identifier") or issue.get("id")), url=issue.get("url"))
