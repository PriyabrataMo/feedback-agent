# Journal

Newest entry first. Append after every meaningful discussion. Record decisions with the *why*.

## 2026-10-24 — Ticket pipeline, security review fixes, replay player
- Ticket worker + Linear/webhook sinks landed (docs/tickets.md); verified only against mocks, not real Linear/OpenAI. SDK `navigations` were being dropped by `/end`; fixed (cap 30, re-shaped server-side).
- An adversarial review (headless Chrome + ASGI probes) found issues; **fixed now:** env check fails closed (anything but development/test hides admin + storage routes); ephemeral realtime token expires after 60s; session quota is atomic (slot reserved under a per-project lock before the provider call); upload content-type forced to video/webm|mp4; streamed body-size limits, NaN/deep-nesting/lone-surrogate no longer 500; SDK stops screen tracks when the mic is refused and rejects non-tab shares; consent copy now says private fields are hidden from the replay only.
- **Still open (from the review):** per-IP rate limits and a bootstrap token (the Origin allow-list only stops other browsers); server-side session-length enforcement and per-session chunk/byte caps; S3 presigned PUT has no size limit (use presigned POST with content-length-range); 2nd `/end` overwrites the first; SDK Done/Cancel not wired until session start resolves, fetches have no timeout, no `pagehide` end beacon or abandoned-session sweeper; URL query strings and console args are stored unmasked; screen video and model screenshots are unmasked (P0 privacy, see mvp-security-plan.md); replay must run in a sandboxed iframe (attacker-authored rrweb events); dev storage secret still has a default; `/docs` is public in dev; uvicorn logs signed URLs; rrweb is `latest` in package.json.
- Dashboard replay player landed: rrweb Replayer + synced video + click-to-seek transcript/timeline + ticket card; `GET /api/v1/admin/sessions/{id}/events`; HTTP Range on the stitched media route (needed for video seeking). Verified in headless desktop Chrome only; ticket card never rendered with live data. Replay still needs the sandboxed-iframe hardening above.
- Collaborator invite for `shubhamku044` is sent (write access), pending acceptance.

## 2026-10-24 — MVP and security review
- Added the consolidated recommendation to `docs/mvp-security-plan.md`.
- Recommended narrowing the MVP to one measurable outcome: a live interviewer produces an actionable draft report without developer follow-up. *Why:* recording, AI summaries, and agent-ready context are increasingly commodity features; interactive clarification is the product hypothesis that still needs validation.
- Recommended a review/edit/approve gate and signed webhook before automatic ticket creation. *Why:* public feedback is untrusted and may be vague, malicious, privacy-sensitive, or misclassified.
- Identified a P0 privacy defect: `data-private` and rrweb masking do not redact the raw screen stream or screenshots sent to the realtime provider, so the current “private fields are hidden” copy is inaccurate.
- Recommended two explicit capture modes: a privacy-safe default without raw pixels, and a clearly disclosed full-context opt-in mode for low-sensitivity routes/accounts.
- Recommended treating the top-level SDK as privileged third-party code, with immutable releases, a self-host option, CSP/SRI guidance, a minimal host collector, and iframe isolation where practical.
- Recommended short-lived signed launch grants, strict tenant isolation, bounded uploads, sandboxed replay, prompt-injection boundaries, webhook SSRF controls, and complete deletion/retention behavior before general availability.
- Recommended excluding regulated/high-sensitivity routes and markets from the MVP rather than claiming redaction or compliance that has not been demonstrated.

## Open questions
- Which realtime provider? (default proposal: OpenAI Realtime over WebRTC; not yet confirmed)
- rrweb-by-default vs video-by-default? (recommended: rrweb default, video opt-in; not yet confirmed)
- Next step: competitor deep-dive (VoiceDot, Gripe) vs prototype vs full architecture doc? (not yet chosen)
- Product name, target customers, pricing: not discussed yet.
- BYOB launch scope: AWS S3 only first, GCS second? (proposed, not confirmed)
- Jira in starter adds roughly a week to the MVP; build order Linear -> GitHub -> Jira (proposed).
- Is "self-hosted / data never leaves your environment" a future enterprise tier? (BYOB alone doesn't deliver it.)

## Decisions so far
Confirmed by user (2026-10-24):
- Storage is per-project **managed (our S3) or BYOB (customer AWS S3 / GCS)**. *Why:* customers with compliance needs want media in their own cloud; others want zero setup.
- If a BYOB bucket is unreachable mid-session: **drop the chunks and alert** (no managed spill buffer). *Why:* keeps the "we never hold your data in BYOB mode" story simple.
- **Generic webhook is a starter-plan sink.** *Why:* it lets any other tracker integrate without us building each adapter.
- Starter sinks are **Linear, Jira, GitHub Issues, and webhook**. No native Slack integration in starter; the webhook covers notification needs for now. *Why:* user confirmed "webhook is good" (twice); a native Slack app is extra surface for little gain at launch.

Proposals only, not yet confirmed (see `architecture.md`):
- Masking must run client-side. *Why:* once raw pixels hit S3, PII is already stored.
- Desktop Chrome only for MVP. *Why:* `getDisplayMedia` unsupported on most mobile web, weak on Safari/Firefox.
- Tenant-scoped S3 prefixes and queries from day one. *Why:* retrofitting isolation is painful.
- Ticket quality is the product, not the recording. *Why:* recording widgets (Jam, Marker.io, Userback) are commodity.

## 2026-10-24 (parallel agents) — Multi-page investigation, S3 adapter, SDK nav markers
Five agents ran in parallel (session 75a4cade); this entry covers the ones finished so far. Tickets, replay player and the security review are logged when they land.

**Multi-page sites (full report: `multipage-investigation.md`; tested in real Chrome, 3/3 runs):**
- Today's in-page capture **dies on any full page load** (same- and cross-origin); nothing resumes.
- A **popup on our origin** that owns tab capture, mic, recorder and the agent connection **survives the opener's navigations** (video followed the tab, no chunk gap, peer connection stayed up). `sessionStorage` carries the session id across same-origin loads; the popup re-supplies it by `postMessage` after a cross-origin hop.
- Document Picture-in-Picture and a hidden iframe both die when the opener navigates (ruled out). Workers ruled out from docs only.
- Gotchas: `window.open` must run inside the click handler (blocked after ~7 s); a customer COOP header severs `window.opener` (capture still works), so end the session only on the captured track's `ended` event; `window.open('', name)` opens a blank window if the popup is gone, so use probe/reply messages instead; closing the popup sends no goodbye, so abandoned sessions need server-side silence detection.
- **Recommendation (proposal, not confirmed by user):** keep in-page capture as default, add `mode: "multipage"` using the popup controller (~1-1.5 weeks). Browser extension later for internal teams. Server needs heartbeat + abandoned sweeper, `page_view` events, per-page event keys, a collector token.
- Unverified: real tab-picker UX, real speech/OpenAI peer connection (loopback used), Safari/Firefox, popup minimise throttling, mic permission persistence.

**S3 adapter (`apps/api/app/storage/s3.py`, `docs/s3-storage.md`):** managed and BYOB (STS AssumeRole + ExternalId) modes, presigned PUT/GET, test-connection. 33 new tests with moto; **no real AWS tested**, IAM/trust policies in the doc are untested. Nothing passes a BYOB config yet (Project has no storage fields) and no route exposes test-connection.

**SDK (`packages/sdk`):** SPA navigation markers (`nav.ts`; query strings and non-route hashes stripped; rrweb custom `navigation` events; click `url`). Screenshot path fixed: the first frame is now sent **before** the greeting. Live run: image tokens 323 per 768 px frame (was 0), greeting response 643 total tokens. Only the initial frame was exercised live. Greeting now waits up to 2.5 s for the first frame.
- **Open bug:** `/end` clips context to three keys, so the API drops the SDK's new `navigations` list.

## 2026-10-24 (build, slice 2) — Backend rewritten in Python FastAPI
User asked for the whole backend in FastAPI. Session 75a4cade. Code in `apps/api` (uv, Python 3.12+, FastAPI, httpx, stdlib sqlite3).

**Done (verified):**
- Every Next.js API route and `lib/*` module was ported and then deleted from `apps/web`: public-key + origin auth, sessions create (rate limit), upload-url presign, events ingest, end (clip + `clean_usage`), dev signed storage PUT/GET, stitched media, realtime provider (OpenAI `client_secrets` + mock). **The SDK wire contract is unchanged** (same paths, camelCase JSON, status codes).
- `pytest` suite (`bun run test:api`, 11 tests) covers the old 18 smoke checks plus: CORS headers absent on auth failures, unknown `user` keys dropped, expired and path-traversal signatures, 413 on oversized events, session cap + 60 s grace (410), cross-project session isolation (404), preflight allow-list, production guards (404), store persistence.
- The original `smoke.sh` passes unchanged against :8000 (dashboard checks go to Next on :3000), and a real-Chrome run through `/demo` (mock agent) uploaded 4 media chunks + 4 replay segments cross-origin (:3000 -> :8000) and saved transcript/context.
- Next.js is now dashboard + demo only; `apps/web/src/lib/api.ts` is its typed client for `GET /api/v1/admin/sessions[/id]`. Video playback points the browser at the API's media route.

**Decisions / deviations (mine; tell me to revert any):**
- **Session store is sqlite, not the old JSON file.** *Why:* concurrent-write safety for free and a straight path to Postgres (same columns; swap to async SQLAlchemy/asyncpg). Existing `apps/web/.data` sessions were not migrated (dev data).
- **Preflight is now allow-listed** (reflects the Origin only if some project allows it). The Next version reflected any origin on preflight. The key + origin check on the real request is still the gate.
- **`user` on session create is sanitised** to `userId/accountId/plan` strings; before, it was stored as sent.
- `/api/v1/admin/*` and the media route have **no auth** and 404 only when `APP_ENV=production`. Dashboard auth is still unbuilt.
- The API key now lives in `apps/api/.env` (copied from `apps/web/.env.local`). The web copy is unused and can be deleted.
- Entry point is a factory (`uvicorn app.main:create_app --factory`) so importing the module has no side effects.

**Still unverified / unchanged:** OpenAI path was exercised only via the `client_secrets` mint (a smoke run hit it); I did not run a live spoken session on the new backend. Everything in the slice-1/1b "not verified" lists still stands.

**Next step (proposed):** S3 adapter in `app/storage`, then the worker + Linear sink. Multi-page investigation is running separately (`docs/multipage-investigation.md`).

## 2026-10-24 (build, slice 1b) — Live OpenAI Realtime verified; usage capture added
User added `OPENAI_API_KEY` to `apps/web/.env.local` (gitignored). Session 75a4cade.

**Verified live (real Chrome, fake mic tone, real model):**
- `/v1/realtime/client_secrets` mints an `ek_` token; WebRTC handshake to `/v1/realtime/calls` succeeds with `gpt-realtime`; the model speaks the greeting (~4-5 s after click) and the agent transcript events arrive. In one run it also asked a follow-up ("what you expected to happen, and what actually happened") after hearing the tone.
- Click Done ends cleanly: capture stops, 4 media chunks + replay segments uploaded, `/end` stores transcript + page context.
- Not yet exercised: the model calling `end_session` and the output-audio-drain wait, user speech transcription (the fake mic is a tone, not speech), screen-frame upload to the model (`image_tokens` was 0 because the greeting fired before the first frame), agent voice mixed into the recording.

**Added:** the SDK sums `response.done` usage across the session and sends it with `/end`; stored on the session (`usage`) and shown on the dashboard detail page ("Model usage (tokens)"). The server keeps only finite numbers in a small nested object (client is untrusted). `console.debug` now logs why a session ended (user / agent / timeout / share-stopped).
- Greeting-only response cost 292 tokens (222 text in, 19 text + 51 audio out). That is not a cost estimate: user audio input and image tokens only show up once someone actually talks and the screen changes.
- **Still needed:** one real 2-3 minute spoken session with screen changes to get a true cost per session, then compare with the $0.10 planning figure in `pricing-and-unit-economics.md`.

**Gotcha found:** a dev hot-reload (Fast Refresh) mid-session kills the in-page session without calling `/end` (one test run showed the session cut at ~10 s). Production is unaffected, but when testing, don't edit files in `apps/web` during a session. Abandoned sessions need the heartbeat-timeout path from the architecture doc (status `abandoned` exists in the type but nothing sets it yet).

## 2026-10-24 (build, slice 1) — First code: capture → agent → upload → session record
Built by session 75a4cade at the user's "check the docs and start building". Code is in `apps/web` (Next 16 + shadcn, Bun workspace) and `packages/sdk`. Run steps are in `README.md`.

**What works (verified):**
- API smoke test, 18/18 pass: public-key auth, **server-side origin allow-list**, presigned-style PUT/GET with HMAC (tampered or wrong-method signatures rejected), events ingest, session end, stitched media, dashboard pages.
- Real Chrome run against `/demo` with the **mock agent**: share-tab + mic → 2 recording chunks (VP8 + Opus) and rrweb segments uploaded → session ended → console error, failed request and last clicks saved on the session.
- Masking check on the stored replay: `maskAllInputs` hid the card input value, `[data-private]` content and the widget itself are absent.
- `loader.js` is 5.5 KB (classic script); `session.js` (rrweb + recorder + realtime) is 196 KB and loads only on click.

**Not verified:** the OpenAI Realtime handshake and the end_session flow (no `OPENAI_API_KEY` on this machine, so the app falls back to the mock agent), real-mic audio, agent voice mixed into the recording, Safari/Firefox, a real S3 bucket. The OpenAI adapter is written from the GA API shape (`/v1/realtime/client_secrets`, `/v1/realtime/calls`) and is untested.

**Deviations from `architecture.md` (all proposals, none user-confirmed; revisit):**
- **Shadow DOM instead of iframe** for the widget. *Why:* iframe needs postMessage plumbing for rrweb/console context and `display-capture` permission-policy handling; slice 1 needed to prove capture first. Cost: host-page JS can reach the widget. Closed shadow root isolates CSS only.
- **One object per MediaRecorder chunk, not S3 multipart.** *Why:* S3 multipart parts must be >=5 MB except the last, and a 5 s chunk is ~450 KB here (600 kbps). The worker will stitch chunks (byte-concatenation is valid for a single MediaRecorder stream; the dashboard route already does it). `StorageProvider` therefore has `presignPut`, not multipart methods.
- **rrweb starts at session start**, not a passive pre-click buffer. Console, failed-request and click buffers *are* passive from page load.
- **Screen frames to the model are change-gated:** 768 px JPEG q0.6, max one per 4 s, only if the downscaled view changed >4%. *Why:* one frame per second for 3 min would add ~180 images to a billed, growing context. Real cost per session still has to be measured with a key.

**Stubs / not built yet:** worker (summary, repro steps, dedupe, ticket creation, `TicketSink`), Postgres (dev uses `.data/sessions.json` and `.data/objects/`), S3/GCS adapters, dashboard auth, rrweb replay player in the dashboard, per-project spend cap beyond a sessions/hour limit, tenant sign-up.

**Next step (proposed):** add `OPENAI_API_KEY` to `apps/web/.env.local`, run a real conversation, and record real cost per session. Then S3 adapter, then the worker + Linear sink.

## 2026-10-24 (pricing research) — Competitor numbers and concurrency question
- Full numbers, sources and margin math: `pricing-and-unit-economics.md`.
- Competitors price by seats/sites (Userback $29-159/mo annual, Marker.io $39-149, Jam $14/creator, VoiceDot $19-79). Ladder: ~$29-59 entry, ~$79-199 mid.
- Our cost per 3-min session: ~$0.04 on Gemini 3.8 Live (official pricing) or gpt-realtime mini; ~$0.13+ on OpenAI flagship (third-party figures). Planning figure $0.10, stress $0.30.
- User asked about concurrent-session pricing. Conclusion (proposal): bill on sessions/month; use concurrency only as a per-tier guardrail (Free 1, Starter 2, Growth 5, Business 10+) because feedback sessions are bursty and rarely concurrent.
- Margin works on a cheap model; breaks on the flagship at Growth tier. Prototype must measure real cost per session.
- Caveat: VoiceDot's listing shows $17 all-time revenue (launched Aug 2026); demand for voice-first feedback is unproven.

## 2026-10-24 (later still) — Monetization (proposal, not decided)
- User wants a self-serve SaaS: people sign up and log in themselves.
- **Cost driver:** realtime voice + vision per session (assumed cents per minute, capped ~3 min per session; verify against current provider pricing before setting prices). Storage and LLM ticket-writing are small by comparison.
- **Pricing metric (proposed):** sessions (reports) per month, not seats. *Why:* end users aren't seats, and sessions track our cost 1:1.
- **Tier shape (proposed, numbers are placeholders):** Free (small session allowance, "Powered by" branding, for evaluation), Starter (flat monthly fee + included sessions + overage; Linear/Jira/GitHub/webhook, managed storage), Growth (more sessions, longer retention, BYOB storage, masking controls, dedupe), Enterprise (SSO, DPA, custom retention, self-host talks).
- **Gate by feature, not just volume:** BYOB, SSO, long retention, and audit logs sit in higher tiers because they are what compliance-driven (higher-paying) buyers need.
- **Must-have protections:** per-project monthly spend cap and rate limits, since the public SDK key is exposed and could burn the model budget.
- **Reference prices seen in research:** VoiceDot from $19/mo, Marker.io ~$39-59/mo. These are non-voice or one-way tools; a live agent can price above them if it saves developers triage time.
- Open: price points, free-tier size, whether to charge per session or per resolved/ticketed session, billing stack (Stripe assumed).

## 2026-10-24 (later) — Design discussion: storage and ticket sinks
- **Requirement (user):** video/media goes to a bucket; customers can either use **their own AWS/GCP bucket (BYOB)** or let **us store it** (managed).
- **Requirement (user):** starter plan should include Jira and Linear; asked what else belongs in starter.
- Proposed storage design: `StorageProvider` adapters (S3 first, GCS next, Azure later, S3-compatible free), browser uploads straight to the bucket via presigned URLs, assume-role/ExternalId (AWS) and impersonation/WIF (GCP) instead of stored keys, customer-side CORS config, "Test connection" probe, dashboard-minted presigned GETs. Full detail in `architecture.md`.
- Caveat noted: BYOB is storage-at-rest only; live audio still goes to the realtime provider and transcripts through our worker/LLM.
- Proposed starter sinks: Linear, GitHub Issues, Jira Cloud, plus Slack notification and a generic signed webhook. Everything else later by demand.
- Changes earlier plan: Jira was "later"; now it is in starter. Suggested build order stays Linear -> GitHub -> Jira (Jira is the hardest), so the MVP grows by roughly a week.
- **Not yet confirmed by user:** the proposals above (only the two requirements are the user's).

## 2026-10-24 — Session 75a4cade-52ea-49cc-b553-6afc3119559d
- User pitched the idea (see `idea.md`).
- Assistant gave first take: flow, DOM-context capture (rrweb/console/network) over pure video, dedupe, privacy risks, MVP scope.
- Web search for existing products -> `market-research.md`. Conclusion: live conversational agent filing repro-ready tickets looks open; VoiceDot is closest, verify first.
- Discussed continuing from phone (Remote Control: `/remote-control`; Claude Code on web needs a GitHub repo).
- Resumed discussion in a later session; assistant wrote the architecture sketch -> `architecture.md`.
- Created this folder so context survives summarization.
