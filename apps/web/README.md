# Showbug web (`apps/web`)

Next.js 16 app (Cache Components) for showbugai.com: the waitlist landing page (`/`), the dashboard (`/dashboard`) and the demo host app that embeds the SDK (`/demo`). Read `AGENTS.md` and `node_modules/next/dist/docs/` before changing routing or caching.

```bash
bun run dev      # http://localhost:3000
```

## Pilot request

`/` posts `{ email, company, role, workflow, source, website }` to the same-origin route handler `src/app/api/waitlist/route.ts`. `website` is a honeypot field. The route uses Zod for its runtime/TypeScript schema, applies a MongoDB-backed rate limit, and upserts the qualified request into MongoDB. It retains real error states: `200 {ok:true}`, `413 request_too_large`, `422 invalid_request`, `429 rate_limited`, `502 unavailable`.

Configure `MONGODB_URI` and a long random `WAITLIST_IP_SALT` in the web deployment. `MONGODB_DB` defaults to `showbug`. `NEXT_PUBLIC_API_URL` is used only by the local SDK demo.
