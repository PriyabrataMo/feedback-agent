# Showbug web (`apps/web`)

Next.js 16 app (Cache Components) for showbugai.com: the waitlist landing page (`/`), the dashboard (`/dashboard`) and the demo host app that embeds the SDK (`/demo`). Read `AGENTS.md` and `node_modules/next/dist/docs/` before changing routing or caching.

```bash
bun run dev      # http://localhost:3000
```

## Waitlist

`/` posts `{ email, source: "landing", website }` to the same-origin route handler `src/app/api/waitlist/route.ts`, which validates the email and forwards it server-side to `${SHOWBUG_API_URL}/v1/waitlist` (default `http://localhost:8000`) with the client's `x-forwarded-for`. `website` is a honeypot field. Responses: `200 {ok:true}`, `422 invalid_email`, `429 rate_limited`, `502 unavailable`.

Copy `.env.example` to `.env.local` to override `SHOWBUG_API_URL` / `NEXT_PUBLIC_API_URL`.
