# The Idea

## Original pitch (user, 2026-10-24, near-verbatim)
In any SaaS, people can add our SDK or JS inject. In their UI there is a **feedback agent button**.

When clicked it gets access to the current screen and asks for screen-share and mic access. An AI agent replies "hello, what is your problem?". The user explains their problem (in the current tab, or what they see). When done, the agent says thank you, and screen share + mic stop.

All this time the video and audio are saved to **S3**. Then a **ticket is created** where the company tracks issues, with user context: which area of the app, and the link. The developer team can then pick it up.

## Flow
1. Customer adds SDK `<script>` to their app.
2. End user clicks feedback-agent button.
3. Browser asks for screen-share + mic.
4. Voice agent greets and asks what the problem is; asks follow-ups.
5. Agent wraps up; capture stops.
6. Video/audio (and context) stored in S3.
7. Ticket created in customer's tracker (Jira / Linear / GitHub) with area + link + context.
8. Dev team picks it up.

## Differentiator (working thesis)
A **live conversational agent** that sees the screen, asks clarifying questions in real time, and files a **repro-ready** ticket. Existing tools are either one-way (voice note / screenshot) or have no agent.
