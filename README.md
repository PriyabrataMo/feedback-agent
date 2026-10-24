# Feedback Agent

An SDK/JS snippet any SaaS can embed. Adds a "feedback agent" button; a voice AI agent talks to the user while screen + mic are captured, the recording goes to S3, and a dev-ready ticket is created in the company's tracker.

**Status:** slice 1 built (widget, capture, realtime agent adapter, chunked upload, session record, basic dashboard). Backend is Python FastAPI (`apps/api`); Next.js is only the dashboard/demo. Worker/tickets, Postgres and S3 not built yet. (Last updated 2026-10-24)

## Run it
```
bun install
bun run build:sdk            # bundles packages/sdk -> apps/web/public/sdk/{loader,session}.js
cd apps/api && uv sync && cp .env.example .env   # add OPENAI_API_KEY to .env (optional)
bun run dev:api              # FastAPI on http://localhost:8000  (docs at /docs)
bun run dev                  # Next.js dashboard + demo on http://localhost:3000
bun run test:api             # pytest acceptance suite for the SDK contract
```
- `/demo` is a fake customer app with the SDK embedded (`data-api` points it at the API). `/dashboard` lists sessions.
- Without `OPENAI_API_KEY` in `apps/api/.env` the agent is a mock (greets via speech synthesis; click Done to end). With a key it uses OpenAI Realtime (`REALTIME_MODEL`, `REALTIME_VOICE` optional).
- Dev data lives in `apps/api/.data/` (gitignored): `sessions.db` (sqlite) and `objects/`.
- Dev project: public key `pk_dev_demo`, allowed origins `http://localhost:3000` and `127.0.0.1:3000` (`apps/api/app/projects.py`).
- The SDK talks to the API origin set by `data-api` on the loader script tag (defaults to the script's own origin).
- Next.js here is v16 with Cache Components; read `apps/web/node_modules/next/dist/docs/` before changing routing/caching.

## Code quality

`bun install` installs the shared Husky hooks and `uv sync` installs the Python quality tools. Commits run Ruff, mypy, repository hygiene checks, ESLint, Prettier, and Conventional Commit validation automatically.

```bash
bun run quality             # Python lint/format/types/tests + web lint/format/types
bun run precommit           # run every pre-commit hook against the full repository
```

## Read in this order
1. `docs/journal.md` — running log of decisions, open questions, next steps. **Start here after any context reset.**
2. `docs/mvp-security-plan.md` — recommended MVP boundary, security/PII threat model, and prioritized launch controls
3. `docs/idea.md` — the original idea, verbatim and structured
4. `docs/market-research.md` — competitor scan and where the gap is
5. `docs/architecture.md` — proposed system design
6. `docs/pricing-and-unit-economics.md` — competitor prices, cost per session, tiers, margins

## Conventions
- Append to `docs/journal.md` after every meaningful discussion (newest entry at top).
- Record decisions with the *why*, not just the outcome.
- Source chat: Claude Code session `75a4cade-52ea-49cc-b553-6afc3119559d` (2026-10-24), resume with `claude --resume 75a4cade-52ea-49cc-b553-6afc3119559d` from `~/Documents/9june`.
