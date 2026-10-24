# Pricing and Unit Economics (researched 2026-10-24)

Status: **proposal, nothing decided.** All our-side numbers are placeholders until we measure real cost per session in a prototype.

## 1. Competitor pricing (USD/month)
Source column: "official" = fetched from the vendor's pricing page 2026-10-24.

| Product | Tier | Monthly price | Limits / gates | Source |
|---|---|---|---|---|
| Marker.io | Starter | $59 ($39 annual) | 3 members, 10 projects, no session replay, no Jira | official |
| Marker.io | Team | $199 ($149 annual) | 15 members, 50 projects, session replay, console/network, Jira | official |
| Marker.io | Agency | $129 ($99 annual) | 15 members, 50 client projects, replay, Jira | official |
| Marker.io | Business | custom | SSO/SAML, **webhooks, data masking**, Zendesk/Intercom, Azure DevOps | official |
| Userback | Free | $0 | 2 seats, 2 sites, feedback kept 7 days | official |
| Userback | Team | $39 ($29 annual) | 5 seats, 5 sites, PM integrations | official |
| Userback | Business | $99 ($79 annual) | unlimited seats, 25 sites, session replay, dev tools, AI insights | official |
| Userback | Business Plus | $199 ($159 annual) | 50 sites, webhooks, REST API, privacy controls | official |
| Jam | Free | $0 | 30 Jams/mo, 5 min max, 5 creator seats; Jira/Linear/Slack/webhooks included | official |
| Jam | Team | $14 per creator/mo (annual) | 15 min max, 150 links/mo, 200 AI summaries/mo | official |
| VoiceDot.AI | Free | $0 | first 20 messages | trustmrr.com listing |
| VoiceDot.AI | Solo / Pro / Team | $19 / $39 / $79 | Pro adds unlimited projects + MCP; Team adds shared inbox | trustmrr.com listing |
| Gripe | n/a | not found | pricing page returned 403 | n/a |

Observations:
- Competitors price by **seats + sites/projects**, not usage, because their cost per report is near zero. Ours is not (voice model per session), so usage metering is required.
- Market ladder: entry ~$29-59, mid ~$79-199, upper ~$159-199+, then custom for SSO/security.
- VoiceDot (closest competitor) is founded Aug 2026, 1 person, listing shows $17 all-time revenue. Weak signal only; demand for voice-first feedback is unproven.
- Marker.io gates webhooks and data masking behind its custom Business plan. We include webhook in starter (already decided). Basic masking should NOT be gated, since privacy is a sales blocker.

## 2. Our variable cost per session
Assumed session: 3 minutes, mic streamed all 3 min, agent speaks ~1 min, screen frames streamed.

| Provider/model | Rates | Est. cost per 3-min session | Source quality |
|---|---|---|---|
| Gemini 3.8 Live | audio in $0.005/min, audio out $0.018/min, image/video in $0.002/min | ~$0.04 | **official** (ai.google.dev pricing) |
| OpenAI gpt-realtime-2.1-mini | audio in $10/1M, out $20/1M (~600 in / 1200 out tokens per min) | ~$0.04 | third-party blogs |
| OpenAI gpt-realtime-2.1 (flagship) | audio in $32/1M, out $64/1M, image in $5/1M | ~$0.13 + frames | third-party blogs |

Add: LLM ticket writing ~$0.01-0.02, storage and egress negligible (~22 MB video per session at ~1 Mbps).
Realtime sessions re-bill growing context each turn, so real cost usually exceeds the naive math. **Planning figure: $0.10 per session, stress case $0.30.** Replace with a measured number from the prototype.

## 3. Pricing metric: sessions per month, concurrency as a guardrail
- User asked about concurrent-session pricing (e.g. 10 concurrent). Analysis: concurrency is how voice-infra vendors gate *capacity*. Feedback sessions are rare, short and bursty (a customer may have a few per day), so a concurrency cap would almost never bind and can't be the revenue metric.
- Use **sessions per month** as the billed metric (tracks our cost 1:1).
- Use **concurrent sessions** as a per-tier guardrail: protects against abuse and keeps us under provider rate limits (check provider concurrency limits before launch).

## 4. Illustrative tiers (placeholders, anchored to the competitor ladder)
| Tier | Price | Included sessions | Concurrent cap | Other |
|---|---|---|---|---|
| Free | $0 | 10 | 1 | 1 project, 7-day retention, "Powered by" branding |
| Starter | $39 | 100 | 2 | 3 projects, Linear/GitHub/Jira/webhook, managed storage, 30-day retention. Overage ~$0.60/session |
| Growth | $149 | 500 | 5 | 15 projects, **BYOB storage**, 90-day retention, advanced masking, dedupe. Overage ~$0.40/session |
| Business | from ~$499, custom | 2,000+ | 10+ | SSO, DPA, audit logs, 1-year retention |

## 5. Margin check if a customer uses 100% of included sessions
| Tier | Revenue | Cost @ $0.10/session | Gross margin | Cost @ $0.30/session | Gross margin |
|---|---|---|---|---|---|
| Starter (100) | $39 | $10 | ~74% | $30 | ~23% |
| Growth (500) | $149 | $50 | ~66% | $150 | ~0% |

Before payment fees and fixed infra. Most customers will use far less than their allowance (a guess, unverified: a few percent of active users file feedback), which raises real margin.

Conclusions:
- Provider choice decides viability. Default to a cheap model (Gemini 3.8 Live or gpt-realtime mini); keep the flagship as an opt-in.
- Hard per-project monthly spend caps are mandatory (public SDK key is exposed).
- Free tier costs us up to ~$1-3 per signup at 10 sessions; consider requiring email verification.

## Open
- Measure real cost per session (prototype) before fixing any price.
- Billed per session or only per session that produced a ticket?
- Annual discount (competitors give ~20-35% off).
- Billing stack (Stripe assumed).

## Sources
- Marker.io pricing: https://marker.io/pricing
- Userback pricing: https://www.userback.io/pricing/
- Jam pricing: https://jam.dev/pricing
- VoiceDot listing: https://trustmrr.com/startup/voicedot-ai
- Gemini API pricing (official): https://ai.google.dev/gemini-api/docs/pricing
- OpenAI realtime pricing (third-party summaries; official page blocked fetch): https://www.forasoft.com/blog/article/openai-realtime-api-pricing , https://hackernoon.com/openai-realtime-api-pricing-in-2026-real-world-data-from-4,000-measured-sessions
