# Showbug web (`apps/web`)

Next.js 16 app (Cache Components) for showbugai.com: the waitlist landing page (`/`), the dashboard (`/dashboard`) and the demo host app that embeds the SDK (`/demo`). Read `AGENTS.md` and `node_modules/next/dist/docs/` before changing routing or caching.

```bash
bun run dev      # http://localhost:3000
```

## Waitlist

`/` posts to the same-origin route handler `src/app/api/waitlist/route.ts`. Email is the only required field; company, role, and workflow are optional design-partner qualification, and `website` is a honeypot. The browser also sends disclosed referral, campaign, locale, screen, viewport, and submission-timing telemetry. The route enriches this with browser/device, language, coarse Vercel location, and a salted IP hash, then stores the result in the MongoDB `client` and `request` objects. Raw IP addresses are not stored.

The route uses Zod as its runtime and TypeScript schema, applies a MongoDB-backed rate limit, and upserts by normalized email. A later email-only submission updates telemetry without erasing qualification details supplied earlier. It retains real error states: `200 {ok:true}`, `413 request_too_large`, `422 invalid_request`, `429 rate_limited`, `502 unavailable`.

Configure `MONGODB_URI` and a long random `WAITLIST_IP_SALT` in the web deployment. `MONGODB_DB` defaults to `showbug`. `NEXT_PUBLIC_API_URL` is used only by the local SDK demo.
