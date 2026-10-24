# Proposed Architecture (draft, 2026-10-24)

## Diagram
```
 Customer's SaaS page (browser)                          Your cloud
┌──────────────────────────────────┐
│ loader.js  (<script data-key=..>)│── 1. GET /v1/config ─────▶ API (Next.js/Hono)
│  └─ iframe widget (isolated UI)  │◀─ project cfg, masking,   │  auth: public key +
│                                  │   allowed domains         │  domain allow-list
│ On click (user gesture):         │
│  getDisplayMedia (tab) + mic     │── 2. POST /sessions ─────▶ creates session row,
│                                  │◀─ ephemeral realtime       │ mints ephemeral token
│                                  │   token + presigned URLs   │ + S3 multipart URLs
│                                  │
│  ┌─ WebRTC ───────────────────────────────▶ Realtime model (OpenAI Realtime /
│  │  mic audio + 1fps screen frames          Gemini Live), tools: end_session,
│  │◀─ agent voice + transcript events        flag_severity, ask_followup
│  │
│  ├─ MediaRecorder chunks ── 3. direct PUT ─▶ S3 (per-tenant prefix, KMS)
│  └─ rrweb events + console + network ─ 4. POST /events (batched) ─▶ API ─▶ queue
└──────────────────────────────────┘
                                                              │ 5. session.ended
                                                              ▼
                                              Worker (queue: SQS / BullMQ)
                                               ├ finalize S3 multipart upload
                                               ├ transcribe (if not from realtime)
                                               ├ LLM: summary, repro steps, expected vs
                                               │   actual, severity, area tag
                                               ├ dedupe (embedding similarity -> pgvector)
                                               └ create ticket via integration adapter
                                                    (Linear / GitHub / Jira)
                                                              │
                                      Postgres ◀──────────────┘
                                          ▲
                              Dashboard (Next.js + shadcn/ui): sessions list,
                              replay player + audio, ticket status, project settings
```

## Components

### 1. SDK (`loader.js`, ~5 KB)
- Loads widget in a sandboxed iframe (host CSS/JS can't break it). Iframe needs `allow="display-capture; microphone"`.
- `getDisplayMedia({ preferCurrentTab: true })` and `getUserMedia` must run inside the click handler or the browser blocks them.
- Passively buffers rrweb events, last ~50 console entries, failed requests (wrapped fetch/XHR), last 10 clicks. Rolling window so the agent can include what happened *before* the click.
- Masking runs client-side before anything leaves the browser: `data-private`, password/credit-card inputs, configurable selectors.
- Host app calls `YourSDK.identify({ userId, accountId, plan })`.

### 2. Realtime voice agent
- Browser connects directly to the realtime provider over WebRTC with an **ephemeral token**; API key stays server-side. Backend never proxies audio.
- System prompt is the product: greet, ask what went wrong, ask follow-ups (expected vs actual, frequency, what they clicked), stop after a few questions or a hard cap (e.g. 3 min).
- Tool calls (`end_session()`) let the model close cleanly; client stops tracks.
- Wrap provider behind own `RealtimeProvider` interface so OpenAI <-> Gemini swap doesn't touch the rest.

### 3. Ingest and storage
- **Recording:** `MediaRecorder` with ~5 s timeslice, uploaded via S3 presigned multipart as it goes (closing the tab loses only the last few seconds).
- **Events:** rrweb + logs batched every few seconds to `POST /events`, written to S3 as NDJSON segments. Postgres holds metadata and pointers only.
- **Tenancy:** `s3://bucket/{tenant}/{project}/{session}/...`, KMS per tenant if affordable, lifecycle rule for retention (30/90 days configurable).

#### Storage modes: managed or bring-your-own-bucket (BYOB) — requirement from user, 2026-10-24
Per project, the customer picks where media (video/audio) and rrweb/log segments live:
- **Managed:** our S3, tenant-prefixed, our retention rules.
- **BYOB:** customer's own bucket on **AWS S3**, **GCS**, later **Azure Blob**; S3-compatible (R2, MinIO) comes nearly free via the S3 adapter.

Design:
- `StorageProvider` interface: `initUpload`, `presignPart`, `completeUpload`, `presignGet`, `delete`, `testConnection`. One adapter per cloud; the rest of the system never sees cloud specifics.
- **Browser uploads straight to the bucket** with presigned URLs minted by our API. Media bytes never pass through our servers, for managed and BYOB alike.
- **Access without long-lived keys:** AWS = customer creates an IAM role trusting our account, with an `ExternalId` (confused-deputy protection), scoped to one prefix, and we `AssumeRole`. GCP = service-account impersonation or Workload Identity Federation. Avoid stored access keys / HMAC keys wherever possible.
- **Customer must configure CORS** on their bucket (allow their app origins, `PUT`, expose `ETag`). Onboarding wizard generates the CloudFormation/Terraform/gcloud snippet and a CORS block.
- **"Test connection"** button: write, read, and delete a probe object. Re-run as a periodic health check; surface failures in the dashboard.
- **Playback:** the dashboard mints short-lived presigned GET URLs through the same role. Tickets link to the dashboard session page (needs login), never to a raw bucket URL.
- **Retention in BYOB:** the customer owns lifecycle; we document a recommended rule and only delete what we wrote if they ask us to.
- **Honesty point:** BYOB covers storage at rest only. Live audio/frames still go to the realtime model provider, and transcripts pass through our worker and an LLM. Don't claim "data never leaves your environment" without a separate self-hosted/enterprise story.
- **Decided:** if a BYOB bucket is unreachable mid-session, drop the chunks and alert the customer. No managed spill buffer, so BYOB media never touches our storage.

### 4. Processing worker
- Triggered on session end, or heartbeat timeout for abandoned sessions.
- LLM turns transcript + page context + console/network errors into structured ticket: title, repro steps, expected vs actual, severity guess, area (from route or customer-provided component map).
- Dedupe: embed summary, compare to open tickets in pgvector. Close match -> comment + link on existing ticket; else create new.

### 5. Integration adapters
- Common `TicketSink` interface (`create`, `comment`, `link`, `testConnection`). OAuth tokens encrypted. Webhook back so ticket status appears in dashboard.
- Tickets carry **links** (dashboard session page, replay) plus the text summary, not file attachments. This avoids tracker size limits and keeps BYOB media private.
- Per-project field mapping (team/project/repo, labels, issue type, priority) set in the dashboard.

**Starter-plan sinks (proposed, 2026-10-24):**
| Sink | Role | Effort / gotchas |
|---|---|---|
| Linear | Core | GraphQL, clean OAuth, easy |
| GitHub Issues | Core | REST, GitHub App install, easy |
| Jira Cloud | Core (requested) | OAuth 2.0 (3LO), description is Atlassian Document Format (not markdown), required custom fields vary per project/issue type, so field mapping + validation needed. Hardest of the three. |
| Generic webhook | Escape hatch (confirmed for starter) | Signed JSON POST; lets anyone else integrate and defers all other trackers |

**Later, by demand:** native Slack app (Slack incoming webhooks can already be fed from the generic webhook), GitLab Issues, Azure DevOps Boards, Shortcut, ClickUp, Asana, Trello, Notion, monday.com; support-desk sinks (Zendesk, Intercom) if aiming at support teams; Microsoft Teams notifications. Verify each API's current state before building.

### 6. Dashboard / control plane
- Next.js + shadcn/ui (user's stack preference, Bun).
- Pages: project + API keys, domain allow-list, masking/retention settings, session list, session detail (rrweb replay, audio, transcript, ticket link).

## Data model (Postgres)
```
tenants -> projects (public_key, allowed_domains, retention_days, sink_config)
sessions (project_id, end_user_id, url, status, started_at, ended_at, s3_prefix)
session_artifacts (session_id, kind: audio|video|rrweb|logs, s3_key)
transcripts (session_id, segments jsonb)
tickets (session_id, sink, external_id, url, dedupe_group_id, embedding vector)
```

## Suggested stack
| Layer | Pick | Why |
|---|---|---|
| SDK | TypeScript + esbuild/tsup | Small bundle |
| API | Next.js route handlers, or Hono separate service | One repo to start |
| DB | Postgres + pgvector | Metadata + dedupe in one |
| Queue | SQS, or BullMQ + Redis for MVP | Simple first |
| Storage | S3 + KMS | Already planned |
| Realtime | OpenAI Realtime over WebRTC | Simplest wiring |
| Deploy | ECS containers, or Fly/Railway to start | Skip k8s for MVP |

## Risks and constraints
- **Screen share can't be silent:** browser picker always shows; user may pick another tab. Safari/Firefox weaker. Mobile web mostly lacks `getDisplayMedia` -> desktop Chrome only for MVP.
- **Privacy is the sales blocker:** PII on screens. Need masking, consent line, retention, region, per-tenant S3 prefix + KMS from day one.
- **Strict CSP** on customer sites can block the script; document allow-list entries.
- **Cost:** realtime voice + vision ~cents/minute; cap session length.
- **Abuse:** public keys are exposed; rate-limit session creation per key/IP; enforce domain allow-list server-side, not just in SDK.

## MVP scope (2–3 weeks)
- Widget + voice agent, Chrome only
- rrweb, console errors, network errors, audio to S3; video optional
- Storage: managed S3 + BYOB AWS S3 (assume-role). GCS right after.
- Integrations: Linear + GitHub first, then Jira, plus generic webhook (no native Slack at launch)
- Next.js dashboard (shadcn/ui): list sessions, play replay + audio
- API key per project + domain allow-list
