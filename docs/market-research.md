# Market Research (2026-10-24)

Caveat: from web searches and vendor descriptions only. Reviews and current features not verified. Re-check before relying on it.

## Closest (voice + feedback widget)
| Product | What it does | Gap vs our idea |
|---|---|---|
| VoiceDot.AI (trustmrr.com/startup/voicedot-ai) | User pins a spot on the live page and leaves voice/text feedback; one thread of words+page+pin. Read-only MCP server so coding agents can read it. From $19/mo. | One-way recording. No live agent follow-ups, no screen share. **Closest competitor, try it first.** |
| Gripe (peerlist.io/paulblaiset/project/gripe) | One-tap voice/text widget; AI tags by action/severity/priority, clusters recurring issues; target by page/plan/audience. | Triage, not bug reproduction. |
| FounderPing (peerlist.io/willwangdev/project/founderping) | Embedded AI widget that converses instead of a survey. | Aimed at founders/PMs; nothing seen on screen context or tickets. |
| Voicepanel (hunted.space/product/voicepanel-2) | AI user research over voice/video/screen share, results to Slack; recently embeddable. | More AI-run interviews than bug capture. |

## Bug-report widgets with ticket creation (no voice agent)
- **Jam** — screen recording + console logs, network, DOM snapshots -> issue trackers. Free tier.
- **Marker.io** — widget/extension, annotated screenshots, session replay, auto browser/OS/console capture. ~$39–59/mo.
- **Userback** — annotated screenshots, replay, video, metadata. Most G2 reviews (242).
- **IssueCapture** — drop-in widget filing Jira/JSM bugs with screenshot + console + browser context.
- **FeedBug** — Linear issues with screenshot, URL, diagnostics, live pin link.
- **BugSmash** — visual review; comment -> Jira ticket + Slack ping.

## Adjacent
- HyperVoice — spoken description -> structured ticket, manual paste into Jira/Linear/GitHub.
- Sista AI — voice agent platform w/ on-screen context, can click/navigate; not feedback-focused.
- Also from memory (unverified): Sentry user feedback, LogRocket, FullStory.

## Takeaways
- **Crowded:** widget + screenshot/replay + Jira/Linear ticket. Don't compete here.
- **Partly taken:** voice feedback pinned to page element (VoiceDot, Gripe), but one-way.
- **Open (as far as found):** live conversational agent that sees the screen, asks follow-ups, files a repro-ready ticket.

## TODO
- [ ] Try VoiceDot: does it have a live back-and-forth mode?
- [ ] Deeper dive: VoiceDot and Gripe (pricing, widget mechanics, integrations)
- [ ] Positioning vs Jam / Marker.io
