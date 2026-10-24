# Ticket pipeline

When a session ends (`POST /api/v1/sessions/{id}/end`), a worker summarises it into a dev-ready ticket and creates it in the project's tracker through a `TicketSink`. Code: `apps/api/app/worker/` (job), `apps/api/app/tickets/` (sinks). Ticket failures never change the `/end` response (always 200).

## Flow
```
POST /end -> store.end() -> worker.enqueue(id)        (marks ticket_status=pending, never raises)
worker.process(id):
  claim (pending|failed -> creating, atomic)           another/duplicate job loses the claim and exits
  project has no sink?  -> skipped
  build sink from project config (missing secret -> failed: "LINEAR_API_KEY is not set")
  facts   = sanitise(session)                          control/bidi chars stripped, truncated, URLs http(s) only
  summary = OpenAI strict-JSON, or deterministic fallback (no key, HTTP error, bad JSON, refusal)
  draft   = render markdown body                       stored on the session (summary, repro_steps, ticket_draft)
  sink.create(draft)                                   retries with backoff; idempotent
  -> created (+ ticket_url, ticket_external_id)  |  failed (+ short, secret-free ticket_error)
```
Session fields (also in the admin API, camelCase): `ticketStatus` (`pending|creating|created|failed|skipped`), `ticketUrl`, `ticketExternalId`, `ticketError`, `summary`, `reproSteps`. The rendered draft (`ticket_draft`) is kept internally so a retry never re-bills the LLM.

Re-sending `/end` for a `failed` (or `skipped`) session re-queues it; for `pending|creating|created` it is a no-op.

## Ticket body
Summary, steps to reproduce, context (page link, end-user `userId/accountId/plan`, browser, session id, **recording link** `{DASHBOARD_BASE_URL}/dashboard/{sessionId}`, severity guess, area), transcript excerpt (most recent ~4 KB), console errors, failed requests, last clicks. Severity maps to Linear priority (critical=1 urgent, high=2, medium=3, low=4).

## Untrusted content
Transcript, console text, click labels and URLs come from the end user's browser. Rules (`tickets/sanitize.py`):
- Control characters, zero-width and bidi-override characters are stripped; everything is truncated.
- Multi-line user text is only ever rendered inside a code fence longer than any backtick run it contains, so it cannot become headings, links or images in the tracker.
- LLM output (itself derived from untrusted text) is validated against the schema, re-sanitised, and rendered with `[ ] < > \`` escaped, so a prompt-injected summary cannot embed links, images or HTML.
- The LLM gets session data as one JSON blob in the user message; the system prompt says it is untrusted data. Output is JSON-schema constrained (`strict`), so there is no free-form channel.
- Page and request URLs: `http(s)` only, fragment dropped, markdown/HTML-breaking characters percent-encoded. **Query strings are kept** (devs need them) and can contain tokens; client-side masking of URLs is not built.

## Sinks
Project config (`projects.py`): `Project.ticket_sink = SinkConfig(kind, options, secret_env)`. `secret_env` is the *name* of an env var; secrets are never stored on a project. The dev project picks its sink from env (below).

**Linear** (`tickets/linear.py`): GraphQL `issueCreate` to `https://api.linear.app/graphql` with `teamId`, `title`, `description`, `priority`, optional `labelIds`. Personal API keys go in `Authorization` as-is; `lin_oauth_*` tokens get `Bearer`.
- *Idempotency:* the issue `id` is a deterministic UUID derived from `projectId:sessionId`. After a timeout/5xx the sink looks the issue up by that id before retrying, and after a non-retryable error it checks once whether the issue already exists. A lost response can therefore never produce a second issue.
- *Errors:* 429 / `RATELIMITED` / 5xx / network = retry (3 attempts, exponential backoff + jitter, honours `Retry-After`, max 30 s). 401/403 and GraphQL validation errors fail immediately.

**Webhook** (`tickets/webhook.py`): `POST` JSON `{"event":"ticket.requested","version":1,"ticket":{title, body_markdown, summary, repro_steps, severity, area, page_url, recording_url, session_id, project_id, idempotency_key, source, labels}}`. Headers:
```
X-Feedback-Timestamp:       unix seconds
X-Feedback-Signature:       sha256=<hex HMAC-SHA256(secret, f"{timestamp}.{raw_body}")>
X-Feedback-Idempotency-Key: <projectId>:<sessionId>   (dedupe on this; we retry on timeouts and 5xx)
```
Verify on the receiver: recompute over the **raw** body bytes, compare in constant time, reject timestamps older than ~5 minutes. A 2xx ends the job; the response may be JSON `{"id","url"}` to surface a link on the dashboard. 408/425/429/5xx and network errors retry; other 4xx fail. The URL must be https (http allowed for localhost). When webhook URLs become user-configurable, add an SSRF guard (block private/link-local ranges) in `validate_webhook_url`.

Add a tracker: write a class with `kind` and `async create(draft) -> TicketResult` (idempotent per `draft.idempotency_key`, raise `TicketError(retryable=...)`), then register a factory in `tickets/registry.py`.

## Queue seam (replacing the in-process queue)
`TicketWorker.enqueue(session_id)` is the producer; `TicketWorker.process(session_id)` is the entire job and is safe to run repeatedly (atomic claim + idempotent sinks), as at-least-once queues (SQS, arq, Celery, BullMQ-style) require. To switch: make `end_session` publish `session_id` to the real queue and run `process` in a consumer. The asyncio queue is lost on restart, but state is in the DB: on startup `creating` jobs are reset to `pending` and every ended `pending` session is re-queued. Heartbeat-timeout (abandoned) sessions are not ticketed yet.

## Config (env)
| Var | Purpose |
|---|---|
| `OPENAI_API_KEY` | Enables LLM summaries (shared with the realtime agent). Unset = deterministic fallback. |
| `TICKET_SUMMARY_MODEL` | Chat-completions model, default `gpt-4o-mini`. |
| `OPENAI_BASE_URL` | Optional, default `https://api.openai.com/v1`. |
| `DASHBOARD_BASE_URL` | Base for the recording link in tickets; default `http://localhost:3000` (placeholder). |
| `LINEAR_API_KEY`, `LINEAR_TEAM_ID` | Dev project uses Linear when both are set. `LINEAR_LABEL_IDS` (comma-separated label UUIDs) optional. |
| `TICKET_WEBHOOK_URL`, `TICKET_WEBHOOK_SECRET` | Dev project uses the webhook sink when `TICKET_WEBHOOK_URL` is set (and no Linear pair). |
| `TICKET_WORKERS` | Concurrent worker tasks, default 2. |

## Not built yet
Dedupe against open tickets (pgvector), `comment`/`link`/`test_connection` on sinks, GitHub and Jira sinks, status webhooks back into the dashboard, per-project spend caps on summarisation, URL masking, tickets for abandoned sessions.
