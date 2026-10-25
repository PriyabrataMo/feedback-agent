# Storage plan: S3, signed URLs, deletion, database references, scale

**Status: plan only, nothing built, nothing deployed.** Written 2026-10-25 from reading the code (`apps/api/app/storage/`,
`app/tenancy/storage.py`, `app/routes/{sdk,admin}.py`, `app/sessions.py`, `packages/sdk/src/session.ts`,
`infra/aws/`, `docs/tenancy.md`, `docs/s3-storage.md`). Scope: the **managed** bucket in our own AWS account.
BYOB gets notes only. Account, region and environment layout are in the earlier AWS plan (new personal account,
pre-prod and prod buckets, dev on local storage); this document is what runs on top of that.

Contents: [Findings](#1-what-the-code-does-today-and-what-is-wrong-with-it) · [Contract](#2-the-contract) ·
[Layout](#3-object-layout) · [DB references](#4-database-references) · [Signed URLs](#5-signed-urls) ·
[Deletion](#6-deletion-and-retention) · [Bucket and IAM](#7-bucket-and-iam) · [Traffic](#8-what-happens-under-large-traffic) ·
[Observability](#9-observability) · [Phases](#10-phases) · [Tests](#11-test-plan) · [Runbooks](#12-runbooks) ·
[Decisions](#13-open-decisions) · [Evidence](#14-evidence-and-confidence)

## 1. What the code does today, and what is wrong with it

Read from the code; none of it was run against real S3.

| # | Finding | Where | Consequence |
|---|---|---|---|
| F1 | **Every chunk upload would fail on real S3.** The API signs `Content-Type: video/webm`; the SDK sends `Content-Type: recorder.mimeType`, which is normally `video/webm;codecs=vp8,opus`. `content-type` is a *signed* header (checked offline with botocore: `X-Amz-SignedHeaders=content-type;host`), so S3 answers `SignatureDoesNotMatch`. The SDK retries 3 times, then counts a failure and moves on | `routes/sdk.py:139-147`, `session.ts:81-107` | The local backend and moto do not check signatures, so every test passes. First real browser upload fails. Silent for the user: the recording is just missing |
| F2 | **Playback loads the whole recording into API memory on every request.** `stitched_media` lists the chunks, downloads all of them, joins them, then slices the Range. Every seek repeats it | `routes/admin.py:71-98` | Memory and S3 reads per request grow with session length. First thing to break under real use |
| F3 | Replay does the same for events: lists, downloads and JSON-parses every segment per request | `routes/admin.py:43-68` | Same shape of problem, plus CPU |
| F4 | **Purge deletes one key at a time** (`DeleteObject` per key, each in a thread hop) | `TenantStorage.purge`, `S3Storage.delete` | An org with 1M objects at ~50 ms each is ~14 hours. `DeleteObjects` (1,000 keys per call) is not used |
| F5 | Presigned PUT has **no size limit**; the route accepts `seq` up to 100,000; there is no per-session byte or chunk cap | `routes/sdk.py:26,136`, journal 2026-10-24 | Cost abuse: one copied public key can write far more than a real session |
| F6 | **The database knows only a `prefix`.** Today a SQLite `sessions` row (`.data/sessions.db`) with `prefix = {project}/{session}`, no org. Chunks are found by listing S3. The kernel design (Mongo, `prefix = {org}/{project}/{id}`) is not wired to the data plane yet | `sessions.py`, `tenancy.md` data model | No state, no counts, no byte totals, no way to tell "done" from "abandoned" from "partially uploaded" |
| F7 | A presigned PUT minted just before a delete stays valid for its lifetime (300 s now) | `routes/sdk.py:147` | An object can be written **after** the purge and be orphaned |
| F8 | boto3 runs through `asyncio.to_thread` on the default executor, which has `min(32, cpu+4)` threads. Every events segment is a server-side `put_object` through the API | `storage/s3.py`, `routes/sdk.py:174` | A 1–2 vCPU machine has about 5–6 S3 threads: roughly 80–100 segment writes per second before queuing (assuming ~60 ms per write: measure) |
| F9 | Docs disagree: `tenancy.md` says the client's content type is never signed; `s3-storage.md` says the SDK header must match the signed one | docs | Resolved by the fix to F1: the server dictates the exact fields |
| F10 | `infra/aws/storage.cfn.yaml` has one CORS rule (PUT and GET) for one origin list, and the list is per customer origin | template | A new design partner means a stack update, and GET is allowed from widget origins that never need it. The bucket CORS limit (100 rules, 64 KB) also caps scale |
| F11 | Still open from the 2026-10-24 review: uvicorn logs signed URLs, no abandoned-session sweeper, no per-session caps | journal | Fixed by this plan, see sections 5, 6, 9 |

Nothing in the ticket worker reads recordings (`app/worker`, `app/tickets` never touch storage), so a media
finalising job is net new. The `stitched_media` docstring already says production playback should be "a
worker-finalised object behind a presigned GET": this plan is that intent, worked out.

## 2. The contract

1. **Bytes live in S3, state lives in the database.** The database holds pointers, state and counters, never bytes
   and never URLs. S3 holds bytes and no state.
2. **Browsers talk to S3 directly** for media and read from S3 directly for playback. The API signs and authorises;
   it does not carry video.
3. **Keys are deterministic**, so the database needs counts, not a row per object (section 4).
4. **Every signed URL is short-lived, exact-object, single-purpose, never stored, never logged.**
5. **Delete means: mark in the database first, delete in S3, wait out in-flight uploads, verify empty, then clear.**
   It is resumable and idempotent at every step.
6. **The database decides what exists and for how long; S3 lifecycle is only a backstop.** A reconcile job
   catches the disagreements.
7. **Fail quiet for the customer's page, fail closed for data.** An overloaded or broken Showbug must never block the
   host app; an unknown state never serves or keeps data.

## 3. Object layout

```
{S3_KEY_PREFIX}/{org}/{project}/{session}/media/{seq:06d}.{webm|mp4}     raw MediaRecorder chunks (5 s each)
{S3_KEY_PREFIX}/{org}/{project}/{session}/events/{seq:06d}.ndjson        rrweb segments (≤ 1 MB, every 5 s)
{S3_KEY_PREFIX}/{org}/{project}/{session}/final/media.{webm|mp4}         finalised, seekable recording   (new)
{S3_KEY_PREFIX}/{org}/{project}/{session}/final/replay.json.gz           all events as one JSON array     (new)
```

- `app/tenancy/storage.py` `_OBJECT` and `_PREFIX` must learn `final/`. Nothing else about isolation changes.
- Keys contain ids only, no names, emails or URLs. Object metadata carries no personal data.
- Sizes (assumptions to measure in pre-prod): video 600 kbps (`session.ts:83`) is about 75 KB/s, so a full 180 s
  session is roughly 14 MB and 36 chunks of ~375 KB. Events are assumed ~1 MB per session in 36 segments.
- **Finalising** concatenates the chunks (MediaRecorder chunks concatenate byte for byte), remuxes with
  `ffmpeg -c copy` (no re-encode: seconds of CPU) so the file has a duration and seek index, writes
  `final/media.*`, compacts events into `final/replay.json.gz` (object metadata `Content-Encoding: gzip`,
  `Content-Type: application/json`), verifies sizes, then deletes the raw chunks and segments after a one-hour grace.
  This halves steady-state object count and removes LIST and N-GET from every read.
- Single-storage class (Standard). Retention is at most 30 days, and Intelligent-Tiering and Standard-IA both have
  30-day minimum charges, so tiering never pays.

## 4. Database references

Fields added to the `sessions` collection (project kind, `app/db/specs.py`; migration `m0002` or later). Names are
proposals.

```
storage:   { profile: "managed" | "byob:<id>" }            # which bucket family; bucket/region resolved from config, never stored per row
media:     { state: none|recording|finalising|ready|partial|failed|missing|deleted,
             reserved_calls, reserved_bytes,              # incremented atomically when a URL is minted (this is what enforces caps)
             expected_chunks, stored_chunks, stored_bytes,# expected from the SDK's /end; stored set by the finaliser from ONE list
             final_key, final_bytes, duration_ms, content_type, finalised_at }
events:    { reserved_calls, reserved_bytes, stored_segments, stored_bytes, replay_key, replay_bytes }
retention: { policy_days, expires_at }                    # set at /end from the project's setting, ≤ the platform ceiling
deletion:  { state: none|deleting|deleted, reason: cancel|retention|abandoned|project|org|erasure, requested_at, completed_at, objects_deleted }
```

- **No per-object rows.** One session is about 72 objects; 1M sessions would be 72M documents. Keys are derivable
  from `prefix` and `seq`, so counts and byte totals are enough.
- **No URLs in the database, ever.** A signed URL is a bearer credential with a lifetime of minutes.
- **`storage.profile` is copied onto the session when it is created.** If a project later changes bucket, old
  sessions still resolve to where their bytes are.
- **Caps are enforced at the moment a URL is minted**, with one conditional update on the session, the same race-free
  pattern as `usage_counters`: `find_one_and_update({_id, "media.reserved_bytes": {$lte: CAP - declared},
  "media.reserved_calls": {$lt: MAX_CALLS}}, {$inc: …})`. No match means `429 rate_limited`. The SDK declares each
  chunk's `size` in the upload-url request. Retries count against the cap, which is sized for them.
- **Project and org byte quotas** are `usage_counters` rows (`storage_bytes_month`), charged on reservation and
  corrected to the real figure when the finaliser lists the prefix.
- **State changes only forward**, with conditional updates (`find_one_and_update({_id, "media.state": from}, …)`),
  claimed with a lease the way `worker_claim` already does, so two workers cannot run the same job.
- **New indexes** (partial, so they stay small): `(project_id, retention.expires_at)` where `deletion.state = none`
  for the retention sweeper; `(media.state, ended_at)` for the finaliser queue; `(deletion.state, requested_at)`
  for the deleter. Each job gets its own registered system door (`retention_sweep`, `media_finalise`,
  `session_delete`) and a row in the purpose table in `tenancy.md`.

### Disagreements between the database and S3

| Situation | How it arises | Handling |
|---|---|---|
| Reserved, never uploaded | tab closed, offline | Finaliser lists once, sets `stored_chunks`, marks `partial` if `expected_chunks` are not all present |
| Uploaded, never reserved | cannot happen: a URL is minted only after the reservation | none needed |
| Object with no session row | purge race, bug, lifecycle gap | Weekly orphan scan of an org's prefix against rows; delete orphans older than 24 h and alert |
| Row says `ready`, object gone | lifecycle, manual delete | Dashboard does one HEAD before signing; on 404 set `media.state = missing`, alert; `verify` samples |
| Mongo down while uploads are in flight | outage | SDK calls fail quietly; already-signed uploads still land; finaliser corrects afterwards |
| Session never ended | tab closed, crash | Abandoned sweeper after deadline + grace marks it `abandoned` and finalises what exists as `partial` |

## 5. Signed URLs

### 5.1 Upload (browser to S3)

| | Today | Target |
|---|---|---|
| Mechanism | presigned **PUT**, signs `Content-Type` | presigned **POST policy** (`generate_presigned_post`) |
| Binds | exact key, content type | exact `key`, exact `Content-Type`, **`content-length-range` 1 to `MAX_CHUNK_BYTES`**, expiry |
| Lifetime | 300 s | **120 s** (a ~375 KB chunk uploads in seconds; every retry mints a fresh URL anyway) |
| Who dictates the headers | the SDK guesses | the API returns `{url, fields}`; the SDK sends exactly those fields. F1 disappears by construction |
| Size | unlimited | 2 MB per chunk (a 5 s chunk at 600 kbps is ~375 KB), 1 MB per events segment (exists) |

Offline check: botocore produces a POST policy with `key`, `Content-Type`, `policy` and the `x-amz-*` fields, and
accepts a `content-length-range` condition. Fallback if POST proves awkward in a real browser: keep PUT and also sign
`ContentLength` from the declared size (S3 then enforces the exact length).

Per-session caps, enforced at mint time (see section 4): media 100 MB (about 7 full-length sessions' worth),
`reserved_calls` 3 × the expected chunk count + 10, events 20 MB and 100 segments. Derived from
`max_session_seconds`, not hard-coded.

Order of checks on `upload-url`: key and Origin, session token, deadline, `deletion.state = none`, caps, then
sign. A session that is being deleted can never get a new URL.

Server-side `put_object` for events stays at first (bounded by the 1 MB body limit, section 8 sizes the thread pool).
Later, events can use the same signed POST with client-side gzip, which takes the API out of the byte path entirely.

### 5.2 Download (browser to S3)

```
Dashboard user ─► dashboard server ─► API: verified user ─► membership(org from URL) ─► role ≥ viewer
                                           ─► session in this project, deletion.state = none, media.state ∈ {ready, partial}
                                           ─► HEAD final object (one request; 404 ⇒ mark missing)
                                           ─► presign_get(final_key, TTL) ─► {url, expiresAt}
Browser ─► S3 directly (Range handled by S3)
```

| | Media | Replay JSON |
|---|---|---|
| TTL | **600 s**, the player refreshes on a 403 or `error` and resumes at `currentTime` | **120 s** (fetched once) |
| Response overrides | `ResponseContentType` fixed by the server, `ResponseCacheControl: private, no-store`, `ResponseContentDisposition: inline` | same |
| Needs CORS | no (`<video>` without `crossorigin`) | yes: `GET` from the dashboard origin(s) only |

Rules:
- The API response that carries a URL is `Cache-Control: no-store`. The dashboard sends `Referrer-Policy: no-referrer`.
- URLs are never written to the database, audit events, logs, error reports or tickets. **Tickets and Linear issues
  link to the dashboard page** (which needs a login), never to a media URL.
- Authorisation happens when the URL is minted. After that it is a bearer credential, so **removing a member stops
  new URLs at once and existing ones live at most 10 minutes**. Say so in the security notes.
- Every mint writes an `audit_events` row (`session.media_view`: actor, session id), without the URL.
- A leaked URL cannot be revoked individually. Emergency: deactivate the signing access key (kills every outstanding URL
  and the API with it), or delete the object. With IAM user keys a URL can live as long as the key; with role
  credentials it also ends when the session credentials do. This is another reason for short TTLs.
- Later (section 10, phase 6): CloudFront with a signed URL or cookie and an origin access control, behind
  `media.<domain>`. Cache TTL must be at most the URL TTL so a deletion takes effect within minutes, and it only pays
  once egress is roughly a terabyte a month or latency matters.

## 6. Deletion and retention

### 6.1 One procedure for every trigger

Triggers: **cancel** (the user, through the SDK), **retention** (expiry), **abandoned**, **project delete**,
**org delete**, **erasure request**. One idempotent routine per session, `delete_session_content`:

1. `deletion.state: none → deleting` (conditional). From now `upload-url`, playback and the dashboard list refuse or hide the session.
2. List the session prefix (paginated) and delete with **`DeleteObjects`**, up to 1,000 keys per call in quiet mode;
   inspect the per-key errors and retry those with backoff.
3. **Wait out the in-flight window**: the longest upload URL lifetime (120 s) plus clock skew (60 s). Use 5 minutes.
4. List the prefix again and delete anything that landed late. Require an empty listing.
5. `deletion.state = deleted`; clear transcript, context, summary and `end_user` from the row; keep a tombstone (ids,
   timestamps, usage, counts, reason) so quotas and audit stay true. Write `session.content_deleted` to `audit_events`.

Crash anywhere: the row is still `deleting`, a worker claims it with a lease and starts again. Nothing is lost
and nothing is deleted twice in a harmful way.

### 6.2 Triggers

| Trigger | Mechanism |
|---|---|
| Cancel | The `/cancel` route marks `deleting` and the deleter does the rest. The tombstone stays (already in the design) |
| Retention | Sweeper every 5–15 minutes: claim sessions with `retention.expires_at < now`, run the routine, batch size bounded, oldest first |
| Abandoned | After deadline + grace without `/end`: finalise what exists as `partial`; delete after the abandoned retention (proposal 7 days) |
| Project / org delete | Mark `deleting` (blocks ingest, hides, as in `tenancy.md`), **wait 5 minutes**, purge by prefix with `DeleteObjects` and bounded parallelism over session prefixes, list again to prove empty, then delete rows in the existing dependency order with the org row last |
| Erasure by end user | Later: index `(project_id, end_user.id)`, find sessions, run the routine. A design hook, not phase-1 work |

Speed: `DeleteObjects` removes up to 1,000 keys per request. S3 allows about 3,500 deletes per second per prefix, and our
prefixes are per session, so the limit is the worker's concurrency, not S3. Rough: 1M objects in minutes instead of
the ~14 hours of today's loop (an estimate, to be measured; plan target in section 11).

### 6.3 Retention

- The platform sets a **ceiling** (proposal 30 days). Each project may choose less, never more.
- `retention.expires_at` is set when the session ends. The sweeper is the normal deleter.
- **S3 lifecycle is a backstop at ceiling + 3 days**, not equal to it. If it equalled the ceiling, S3 could delete
  an object a minute before the sweeper and leave a row saying `ready`. The `infra/aws` template parameter
  `RetentionDays` should therefore be set to ceiling + 3, with a comment saying why.
- Promise to customers: deleted by us within the ceiling plus a day; hard stop by S3 at ceiling + 3 days.
- Incomplete multipart uploads aborted after 1 day (already in the template).

### 6.4 What deletion does and does not cover

- **Versioning stays off** on the managed bucket. With it on, deletes only add markers and the policy deliberately
  lacks `s3:DeleteObjectVersion`. Cost: nothing in S3 can undo a deleting bug, so the guard is the state machine
  (nothing deletes except through `deleting`) and tests. S3 durability itself is not the risk here.
- **MongoDB backups** keep transcripts and tombstones of deleted tenants until the snapshots age out. State the backup
  retention (proposal 7 days) in the data inventory.
- **Copies we do not control:** the ticket in Linear or at a webhook, and the model provider's own retention. Say so in
  the customer-facing wording; deletion covers Showbug's systems.
- Per-tenant deletion is provable: the final empty-prefix listing is the evidence, recorded in `audit_events`.

## 7. Bucket and IAM

Changes to `infra/aws/storage.cfn.yaml` and its README (to be made when the plan is approved):

| Item | Change | Why |
|---|---|---|
| CORS | Two rule sets. **Upload:** `POST` (and `PUT`), origin `*`, no credentials, `ExposeHeaders: ETag`, `MaxAgeSeconds: 3600`. **Read:** `GET`, only the dashboard origin(s) | The signed URL or policy is the authorisation and carries no cookies, so a wildcard origin adds no authority; the API's Origin allow-list is enforced when the URL is minted. Removes the per-customer stack update and the 100-rule ceiling. BYOB buckets still need the customer's own CORS |
| Lifecycle | `RetentionDays` = ceiling + 3; abort incomplete multipart after 1 day | Section 6.3 |
| Encryption | Keep SSE-S3. SSE-KMS only if a customer requires it, and only after a real test (presigned POST with a KMS default is untested; the signer then needs `kms:GenerateDataKey`) | Simplicity; the template notes KMS as unexercised |
| Principals | One IAM identity for the API and a separate one for the worker (finaliser, sweepers, purge), both limited to `<prefix>/*`, no `DeleteObjectVersion`, no bucket-level write actions. Move to roles when the host supports OIDC federation (not checked) | Smaller blast radius, separate rotation |
| Deny rules | Keep the non-TLS deny. Optional: deny everything except the named principals | Defence in depth |
| Logging | S3 server access logs to a separate private log bucket with a 30-day expiry; CloudTrail management events; CloudWatch S3 request metrics on prod. CloudTrail data events only if a customer asks | Forensics and alarms at low cost |
| Guardrails | Account-level Block Public Access, IAM Access Analyzer, AWS Budgets, Cost Anomaly Detection | Already in the AWS plan |
| Env | `S3_BUCKET`, `S3_REGION`, `S3_KEY_PREFIX` per environment; `docs/deploy.md` (missing today) lists them | The README links to a file that does not exist |

## 8. What happens under large traffic

### 8.1 Where the load goes

Per full-length session (180 s, 5 s cadence): 1 config, 1 create, **36 upload-url**, **36 events**, 1 end, so about 75
API requests, or **0.42 requests per second per active session**. In S3: about 72 writes (36 browser, 36 from the API),
3–4 requests for finalising, 36 reads while finalising, 2 lists. The media bytes (about 14 MB) go browser to S3 and
never pass through the API. The ticket and finalising jobs are decoupled from ingest through the database, so a
backlog there delays tickets but never recording.

### 8.2 Three scales

Assumptions: average session 120 s, peak concurrency 10 × the average, 30-day retention, 10% of sessions watched
once. All figures are estimates.

| | Pilot | Growth | Large |
|---|---|---|---|
| Sessions per month | 1,000 | 100,000 | 1,000,000 |
| Average concurrent sessions | 0.05 | ≈ 5 | ≈ 46 |
| Peak concurrent (10×) | < 1 | ≈ 46 | ≈ 460 |
| Peak API requests per second (0.42 each) | < 1 | ≈ 19 | ≈ 190 |
| Peak S3 writes per second | < 1 | ≈ 19 | ≈ 190 |
| Stored (30 days of ~15 MB) | ~15 GB | ~1.5 TB | ~15 TB |
| S3 cost per month (storage, writes, reads, egress) | cents | ≈ US$80 | ≈ US$830 |
| Per session | | | ≈ US$0.0008 |

The Large cost, itemised: storage 15 TB × $0.023 ≈ $350; 72M writes at $0.005 per 1,000 ≈ $360; egress 10% × 14 MB × 1M ≈
1.4 TB × $0.09 ≈ $120 (less the free allowance). Finalising adds about $0.04 per 1,000 sessions. **The voice-provider
cost per session probably dominates all of this; see `docs/pricing-and-unit-economics.md`.** Prices are from memory
for us-east-1 and differ by region: check them before relying on them.

Reaching Large needs about 1,000 projects at today's limits (30 sessions an hour, 1,000 a month per project), or raised
limits, up to the platform ceilings.

### 8.3 What breaks first, and what is done about it

| Layer | Behaviour at load | Fix in this plan |
|---|---|---|
| Browser to S3 | S3 scales per prefix (about 3,500 writes and 5,500 reads per second each). Our prefixes are per session, so there is effectively no ceiling. An occasional `503 SlowDown` happens | The SDK retries with backoff and jitter (already 3 tries); finaliser tolerates `partial` |
| API: the events path | Bytes go through the API; F8's thread pool is the first limit (~80–100 segment writes per second on a small machine) | Dedicated bounded executor sized from measurement (or `aiobotocore`); per-instance concurrency limit with `503` shedding; horizontal scale (peak 190 req/s is a few small machines at an assumed 50–100 req/s each: measure); later move events to signed POST with gzip |
| API: playback (today) | O(session) memory and N reads per request (F2) | Finaliser plus presigned GET: playback becomes one Mongo read, one HEAD and a local signature; bytes come from S3 |
| MongoDB | Roughly 75 small writes per session (reservations) plus a few counter upserts. 190 writes per second at peak is routine for a small Atlas tier. The only hot keys are per-project counters, touched once per session create | Indexes in section 4; every read has the 5 s limit; watch connection pool and oplog |
| Finaliser | CPU and bandwidth: each job downloads ~14 MB, writes it back, remuxes. At Large that is ~0.4 jobs/s, about 1 CPU-core sustained and about 10 at peak (estimate) | Separate worker process, concurrency cap, autoscale on queue age, per-job timeout, 5 attempts then dead-letter, spooled temp files (never whole recording in memory), 100 MB input cap |
| Deleters | Bursty after an org delete | Batch `DeleteObjects`, bounded parallelism, backoff on `SlowDown` |
| LIST | Costs the same as a write and is slow | Never on a request path: finaliser (1), deleter (2), reconcile only |
| Voice provider | Its rate limits and cost, not S3, set the real ceiling | Quotas (30/h, 1,000/month, 10 per address per hour) plus platform ceilings; a failed provider call leaves no row and no charge (exists) |

### 8.4 What each party sees when things go wrong

| Failure | Customer's page | Recording |
|---|---|---|
| Quota hit | Nothing breaks. The SDK honours `Retry-After`, stops quietly after bounded retries | None or partial |
| API down or overloaded | Widget hides or stops; the host app is never blocked | None or partial |
| S3 errors | Uploads fail after 3 tries | `partial` or `failed`; the transcript and context still reach the ticket because they go through the database |
| MongoDB down | URL minting fails (`5xx`), same as API down | Already-signed uploads still land |
| Finaliser backlog | Unaffected | Playback waits (`finalising`); the dashboard shows "processing" |
| Cost abuse | Unaffected | Bounded (below) |

### 8.5 Bounding cost abuse

Worst case per project per month = sessions cap × per-session cap = 1,000 × 100 MB = **100 GB, about $2.30 of storage**,
because the quotas and the per-session cap are enforced before a URL is minted. Platform-wide: the budget alarm
and a global switch (`STORAGE_WRITES_ENABLED=false` makes `upload-url` answer `503`) cut off a runaway quickly. The Origin
check does not stop a script, and a signed launch grant is still a hook (see `tenancy.md`).

## 9. Observability

| Signal | Alarm |
|---|---|
| `upload-url` latency (p95) and error rate | p95 above 300 ms for 5 minutes, or 5xx above 1% |
| Reservation rejections (cap hits) per project | Spike versus baseline: abuse or SDK bug |
| S3 request metrics 4xx and 5xx (prod) | 5xx above 0.1%; any `SignatureDoesNotMatch` rise (the F1 class of bug) |
| Finaliser | Oldest `finalising` age above 10 minutes; failure rate above 2%; dead-letter count above 0 |
| Deleter | Any session `deleting` for more than 1 hour (a compliance alarm); sweeper lag |
| Reconcile | Orphans or `missing` rows above 0 |
| Cost | Monthly budget at 50% and 80%; Cost Anomaly Detection |
| Logs | **Test and monitor that no log line contains `X-Amz-Signature` or `X-Amz-Credential`.** uvicorn access logs and HTTP client debug logging are the places they leak |

## 10. Phases

Each phase ends with something that can be shown working.

| # | Work | Exit criteria |
|---|---|---|
| 0 | Account and pre-prod bucket (see the AWS plan), `--profile` in every command, commit the template, write `docs/deploy.md`. **Fix F1** (the API returns the exact fields or headers; the SDK sends those) | A real chunk, uploaded from a browser on the deployed pre-prod demo, lands in the bucket. This is the first time any of this touches real S3 |
| 1 | Fields, migration and indexes; reservation and caps; presigned POST; the SDK declares sizes and reports `expectedChunks` and failure counts in `/end`; abandoned sweeper | Oversized, wrong-key and wrong-type uploads are refused by S3; 100 concurrent reservations never exceed a cap |
| 2 | Finaliser (concatenate, remux, compact events); presigned GET endpoints; dashboard player refresh; remove `stitched_media` and the API-side event concatenation | A recording plays and seeks from S3 with no API memory growth; `partial` is shown honestly |
| 3 | Deleter, retention sweeper, project and org purge with the in-flight window, `DeleteObjects`, extended `verify` (orphans and dangling), template changes (CORS split, lifecycle backstop, logging) | Cancel mid-upload leaves nothing after the window; a 100k-object org purges in under 10 minutes; killing the worker mid-purge resumes |
| 4 | Dashboards and alarms, log-scrubbing test, load and chaos tests, runbooks, then the prod stack | Load targets (section 11) met in pre-prod; alarms fire in a drill |
| 5 | Post-pilot: CloudFront, role credentials (OIDC), BYOB wiring and a CloudFormation/Terraform emitter for the customer's role, erasure by end user, per-tenant KMS | Triggered by egress, a customer request or an audit finding |

Dependencies: the data-plane rewrite onto the Mongo kernel (planned in `tenancy.md`), the Auth0 plan for dashboard
authorisation, and a worker host with ffmpeg.

## 11. Test plan

- **Contract tests against real S3** (pre-prod, nightly and before each release): signed POST accepted for the exact
  key, type and size; rejected for a wrong key, wrong type, oversize and expiry; a key outside the caller's prefix
  can never be minted; GET works until expiry then fails; CORS from an allowed and a disallowed origin; Block Public
  Access, encryption and lifecycle present on the bucket; the `head-object` 404 behaviour from the README.
- **Browsers:** Chrome and Firefox (webm) and Safari (mp4): upload, finalise, play, seek, refresh after expiry.
- **Caps and races:** property tests: any interleaving of reservations never exceeds the caps; illegal state transitions
  are refused; reservations are retry-safe.
- **moto:** listing beyond 1,000 keys, `DeleteObjects` with partial errors, a late object caught by the second list.
- **Deletion:** cancel while a URL is still valid; org delete with in-flight uploads; worker killed at each step then resumed;
  tombstone keeps usage; transcript fields cleared.
- **Reconcile:** a seeded orphan and a seeded dangling row are both found.
- **Isolation:** the existing two-tenant matrix extended to `final/` keys, presigned GETs and the deleter.
- **Logs:** a test that fails if any captured log line contains `X-Amz-`.
- **Load and chaos:** k6 in pre-prod. Proposed targets: `upload-url` p95 under 150 ms at 200 requests per second with no
  5xx; S3 5xx under 0.1%; finaliser queue age under 2 minutes at 10× peak; 100k-object org purge under 10 minutes.
  Chaos: injected S3 `5xx`, a MongoDB primary step-down during uploads (the SDK recovers), an API machine killed
  mid-request.

## 12. Runbooks (to write in phase 4)

1. **Suspected URL leak:** find the session, delete or move the object, and if broader, deactivate the signing key
   and rotate (expect an API outage until the new key is deployed).
2. **Sessions stuck in `deleting`:** check the worker lease and logs; re-run `delete_session_content` for the session;
   confirm an empty listing; record in the journal.
3. **S3 outage or elevated errors:** confirm on the AWS status page; the SDK degrades by itself; no action beyond
   communication, then run the finaliser backlog afterwards.
4. **Cost spike:** identify the project from the reservation metrics; suspend the org (the operator's `operator_orgs` door in `tenancy.md`; the exact CLI command is not checked here) or revoke its key; set
   `STORAGE_WRITES_ENABLED=false` if platform-wide.
5. **Recovering a lost recording:** not possible by design (no versioning, no replica). State this in the customer
   documentation.

## 13. Open decisions

| # | Decision | Recommendation |
|---|---|---|
| 1 | Platform retention ceiling; per-project range | 30 days; projects may choose 1 to 30 |
| 2 | Abandoned-session retention | 7 days, then delete |
| 3 | Raw chunks after finalising | Delete after a one-hour grace |
| 4 | Per-session caps | 2 MB per chunk, 100 MB media, 20 MB events, derived from session length |
| 5 | Remux with `ffmpeg -c copy` versus plain concatenation | Remux: concatenated MediaRecorder WebM usually has no duration or seek index, which breaks seeking (verify in a browser during phase 2) |
| 6 | Upload CORS `*` for POST and PUT | Yes (section 7); keep GET restricted |
| 7 | Presigned POST versus PUT with signed `ContentLength` | POST |
| 8 | Region (shared with Atlas, Fly, Auth0) | Decide with the first design partner's location |
| 9 | When to add CloudFront | When egress reaches roughly 1 TB a month or latency complaints appear |
| 10 | Erasure by end user in the first release or later | Later; design the index now |

## 14. Evidence and confidence

| Claim | Basis | Confidence |
|---|---|---|
| F1 (content-type mismatch) | Code read at both ends, plus an offline botocore check that `content-type` is a signed header. SDK `recorder.mimeType` usually carries codecs in Chrome | High that the mismatch exists; **not run against real S3** |
| F2–F5, F7, F8 | Code read | High. The ~60 ms S3 write used for F8 is an assumption |
| F6 | `sessions.py` (SQLite) against `tenancy.md` | High |
| F11 | Journal entry of 2026-10-24; not rechecked in code | Medium |
| S3 limits (3,500 / 5,500 requests per second per prefix, `DeleteObjects` 1,000 keys, strong consistency, presigned POST `content-length-range`) | Known AWS behaviour, from memory | Medium-high: confirm against AWS documentation before relying on them |
| Prices | From memory, us-east-1 | Medium: check before any budget decision |
| Traffic model (5 s chunks, 14 MB, ~1 MB events, 10× peak, 10% watched) | SDK constants (`CHUNK_MS`, `EVENT_FLUSH_MS`, 600 kbps) plus stated assumptions | Measure in pre-prod |
| Remux fixes seeking | Common behaviour of MediaRecorder output | Medium: verify in a browser |
| ffmpeg time and worker sizing | Estimate | Low: measure |
