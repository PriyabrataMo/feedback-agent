# Multi-page websites: how the widget should work

Status: investigation, 2026-10-24. Tested in real Chrome 155 (macOS). Recommendations are proposals, not decisions.

## 1. Question and why it matters

Today the whole session (screen capture, mic, recorder, agent connection, rrweb) lives in the customer's page. A full page load destroys that page, so the session dies. Most SaaS apps are SPAs (fine), but many B2B products, admin tools, checkouts and anything server-rendered are multi-page. A bug report that cannot survive "click a link, the page loads, the bug appears" is useless for exactly the bugs that matter. Question: what is the cheapest design that keeps one session alive across full page loads?

## 2. Method

Throwaway servers on `localhost:4100` (the "customer site": real separate HTML pages, each a different solid colour so captured frames show which page is on screen) and `127.0.0.1:4200` ("our origin": controller page plus a log/chunk collector). `localhost` and `127.0.0.1` are different origins and different sites, so the cross-origin cases are real. Real Chrome 155 driven by playwright-core, fresh profile per run, fake mic device, `--auto-select-tab-capture-source-by-title` to answer the tab picker.
Code: `/private/tmp/claude-501/-Users-priyabrata-Documents-9june/75a4cade-52ea-49cc-b553-6afc3119559d/scratchpad/mpa/` (`exp1.mjs`, `exp2.mjs`, `exp2-coop.mjs`, `exp2-popup.mjs`, `exp2-close.mjs`, `exp3.mjs`). It is in the session scratchpad, not in the repo.

**Harness limits (what was not tested):** the real tab picker UX (a human choosing a tab); real speech; the real OpenAI peer connection (a local WebRTC loopback stood in for it); Safari and Firefox; HTTPS and real domains; popup placement and minimising on a real desktop; behaviour when the popup is fully occluded for minutes. `--use-fake-ui-for-media-stream` auto-picks a whole *screen*, so it was removed for the tab experiments (the first runs captured the monitor and are discarded).

## 3. Findings

| # | Experiment | Observed | Evidence |
|---|---|---|---|
| 1a | getDisplayMedia + MediaRecorder in page A, same-origin link click to page B | Recording stops at navigation. Nothing resumes. | Chunks arrive 1/s, last one at the click, 0 afterwards (6 s watched). Page B has no recorder. |
| 1b | Same, cross-origin navigation (`localhost` to `127.0.0.1`) | Same: stops. | Chunks 0..1 then none after the click. |
| 2a | Widget opens popup on a different origin; the popup calls getDisplayMedia (user picks the opener tab); opener makes full navigations A to B (same-origin) to C (cross-origin) | **Capture follows the tab through both navigations, uninterrupted.** Track `displaySurface: "browser"`, stays `live`. | Pixel sampled from the captured video every 1 s: red (A), green (B), blue (C). 14-15 chunks over ~15 s with no gap. Repeated 3 times with the same result. |
| 2b | After opener navigates, new document reconnects to the popup with `window.open('', 'fa-controller')` + postMessage | Works **only if the opener link is intact**: returned the real popup, ping/pong round trip worked. **If the popup is gone or the opener link was severed, the same call opens a new blank window.** | Intact: `href` read throws (cross-origin), pong received. After the popup was closed: returned a new window. Under COOP (below): new `about:blank` window appeared. |
| 2b' | Popup posts to `window.opener` after the opener navigated | Works, including after the cross-origin hop; new document receives it. | `msg-from-controller` logged by pages B and C. |
| 2c | sessionStorage on the customer origin across navigations | Survives same-origin navigation (page B read `ses_test1`). **Empty after a cross-origin hop** (page C). The popup re-supplied the session id by postMessage about 1 s later. | `sidInStorage` = `ses_test1` on B, `null` on C, then `msg-from-controller` with `haveStorageSid: false`. |
| 2d-i | Opener tab closed | Captured track fires `ended` immediately. Popup's `opener.closed` also turns true. | `track-ended` at +15 ms, `opener-closed-detected` at +200 ms. The recorder still reports `recording` while the mic track is live, so the controller must end it itself. |
| 2d-ii | User closes the popup | Recording stops (no chunks afterwards). **No pagehide beacon reached the server** (n=1). Page cannot tell except through a failed postMessage or `closed` on a window reference. | 0 chunks after close, no `controller-pagehide` log. So the server must detect abandonment by silence, not by a goodbye. |
| 2d-iii | Opener page served with `Cross-Origin-Opener-Policy: same-origin` | Popup opens, **capture still works**, but `window.opener` is `null` in the popup. No postMessage channel. `opener.closed` logic gives a false "closed". | `hasOpener:false`; frames still red. |
| 2d-iv | Opener navigates mid-session *into* a COOP same-origin page | Capture continues (green frames), but the opener link is severed and the popup's `opener.closed` goes true while the tab is alive. | `opener-closed-detected` fired with `trackState: live`. |
| 2e | Popup blocker (blocker on; Playwright disables it by default, so this run re-enabled it) | `window.open` inside the click handler: opens. After a 1.5 s await in the handler: opens. After a 7 s await: **blocked**. A programmatic call with no activation could not be tested cleanly (Playwright's evaluate counts as a gesture). | `true / true / false`. Consistent with Chrome's ~5 s transient activation. |
| 2e' | Popup UX | `popup,width=360,height=260` opens as a small separate window. The popup needs its **own** click for getDisplayMedia (activation does not cross windows). Could not check minimising or placement. | Runner had to click `#start` inside the popup. |
| 3a | Document Picture-in-Picture window as controller | **Closes when the opener navigates.** Heartbeats from the PiP window and from a hidden cross-origin iframe both stopped at the navigation; `documentPictureInPicture.window` was null on the next page. Spec says the same. | 5 heartbeats each before, 0 after. Spec section 6.7 (see Sources). |
| 3b | Hidden persistent iframe | Dies with its parent document (heartbeat stopped at navigation). Confirmed as expected. | Same run as 3a. |
| 4 | Do mic, recorder, agent connection and frame sampling stay together across navigations in the popup? | Yes for recorder, mic and a WebRTC peer connection. | Loopback peer connection stayed `connected`, `bytesReceived` rose 172 to 52,497 across both navigations. |

Not verified: whether the OpenAI Realtime connection behaves the same as the loopback (it is the same browser WebRTC stack, so expected, but untested). Whether Chrome persists the microphone grant for our origin across different customer sites (expected, since the permission belongs to the popup's origin; untested).

## 4. Options compared

| Option | How it keeps the session alive | UX | Privacy | Eng cost (estimate) | Browser support | Main failure modes |
|---|---|---|---|---|---|---|
| **A. Popup controller on our origin** | Popup owns capture, mic, recorder, agent. Pages are thin collectors. | Extra small window + one extra click; user must pick the right tab in the picker. Works with no install. | Picker is Chrome's own; capture indicator is native. Mic permission belongs to our origin. | ~1 to 1.5 weeks (move session logic into a controller page, collector protocol, abandon handling) | Desktop Chrome/Edge verified. Firefox/Safari untested and not an MVP target. | User picks wrong tab/screen; user closes popup; COOP severs the message channel (capture still works); popup blockers if not opened synchronously. |
| **B. Browser extension** (offscreen document + tabCapture) | Offscreen document records across navigations; no picker if the user clicks the extension. | Best UX, but needs an install per user. | Broad permissions, store review. | 2+ weeks plus store review | Chrome/Edge (Firefox differs) | Install friction kills it for end-user feedback; fits internal QA and support staff. |
| **C. Document PiP controller** | Hoped the PiP window outlives pages. It does not. | n/a | n/a | n/a | n/a | Closes on opener navigation (tested + spec). **Rejected.** |
| **D. SPA-only (current)** | Nothing needed. | Zero friction. | Everything stays in-page. | 0 | Same as today | Full page loads end the session. Soft-nav libraries (Turbo, htmx boost, PJAX) behave like SPAs and work. |
| **E. Per-page resume with re-share** | Each page restarts capture; the user clicks Share again each page. | Bad: repeated picker prompts, voice session restarts, agent forgets. | Same as D | ~3 days | Same | Users will abandon. Only useful as a degraded fallback. |
| Hidden iframe / SharedWorker / ServiceWorker owning the media | Iframe dies with its document (tested). Workers have no `getUserMedia`/`getDisplayMedia`; MediaRecorder is a window API; track processing is dedicated-worker only, so a worker also dies with its document. | n/a | n/a | n/a | n/a | **Rejected** (workers: from MDN and spec knowledge, not tested here). |

How others handle it (from their own docs): Userback says the recording "ends" on a full page load and offers three answers: SPA script-tag install, their browser extension ("continues across page loads on any site"), or a custom server-side change that keeps the script loaded, which they call the most complex. Jam is an extension with tab, window or desktop recording. Marker.io's replay is a rolling in-page recording (their docs say nothing about page loads). I found nothing documenting Loom or Intercom internals; Chrome's own guidance for extensions is "use an offscreen document to record across navigations".

## 5. Recommendation

**MVP:** keep the in-page mode as the default (it is correct for SPAs and has no extra friction) and add **Option A (popup controller)** as a project setting, `mode: "multipage"`, for sites with full page loads. The SDK cannot reliably auto-detect multi-page behaviour, so make it explicit in the snippet or dashboard. Offer the extension (B) later as the polished path for internal teams.

**Why A:** it is the only no-install option that survived real full-page navigations in the tests, including cross-origin ones, and it keeps recorder, mic and agent connection together in one stable context. It moves complexity to our own origin, where we control CSP and permissions, instead of the customer's page.

**Defer:** the extension; Firefox/Safari; wrong-tab verification beyond a basic check; blurring sensitive pixels (the video and frames sent to the model are still raw, same gap as today); per-page UI badge polish.

**Do now regardless of mode:** add SPA navigation markers (`history.pushState`, `popstate`, `hashchange`) as `page_view` events. It is a few lines and also feeds the multi-page design.

## 6. Design of the recommended option

### Flow
1. User clicks the widget on the customer page. In the same click handler (not after any await; blocked after about 5 s), `window.open(<our-origin>/controller?key=...&origin=...&v=1, "fa-controller", "popup,width=360,height=260")`.
2. The popup shows consent text and a Start button (needs its own click). On click it calls `getDisplayMedia({ video: { displaySurface: "browser" }, selfBrowserSurface: "exclude", surfaceSwitching: "exclude", monitorTypeSurfaces: "exclude", preferCurrentTab: false })`, then `getUserMedia({ audio: true })`.
3. The popup creates the session via `POST /api/v1/sessions` (so the 5 s activation window is irrelevant), then runs what `session.ts` does today: MediaRecorder chunk uploads, agent WebRTC, change-gated frames. rrweb is no longer run by the controller; each page's collector runs it.
4. The popup sends the session credentials to the opener's current document (below). The collector stores them in `sessionStorage` and starts rrweb, console, network, click capture.
5. On every full load, the new document's loader finds `sessionStorage["fa:sid"]` (same-origin hop) or answers the popup's probe (cross-origin hop) and resumes as collector.

### Popup to collector protocol (postMessage via `window.opener`)
Secrets must not be broadcast to whatever page happens to be in the tab (the tab could be on a payment provider). So:
- Popup, every 1 s: `opener.postMessage({fa:1, t:"probe", sid}, "*")`. No secrets.
- Collector (always listening once the loader is installed): replies `event.source.postMessage({fa:1, t:"hello", page: {url, title, pageId}}, event.origin)`.
- Popup checks `event.origin` against the project's `allowedOrigins` (already server-side config; the popup fetches it). Only then sends `{fa:1, t:"session", sid, collectorToken, startedAt}` to that exact origin.
- Collector to popup (optional, e.g. a Stop button on the page badge): `{fa:1, t:"stop"}` or `{fa:1, t:"page", pageId, url}`.
- Never use `window.open('', name)` from a page to find the popup (new blank window when the link is severed or the popup is gone; observed).

### Session id handling
`sessionStorage["fa:sid"]`, `["fa:ctok"]` per customer origin; survives same-origin loads, lost on cross-origin hops (popup re-supplies by the protocol above). Same-site subdomain hops (`app.` to `auth.`) also lose it; the probe path covers them. Do not use `localStorage` (leaks into other tabs and outlives the session).

### Opener severed (COOP) fallback
When the host sends COOP `same-origin` (or navigates into such a page), the popup has no `opener`. Capture still works. Degrade cleanly:
- Same-origin hops: collector still has the sid in `sessionStorage` and posts events straight to the server, so page events keep flowing. Needs no popup link.
- Cross-origin hop under COOP: the collector cannot learn the sid. Video and audio continue; replay and page context have a gap for that page. Record `page_view` only if the server can infer it (it cannot), so mark the gap by the missing events.
- Popup must not treat `opener.closed === true` as "tab gone". End only on the captured track's `ended` event (tested: fires when the tab closes).

### Ending conditions
- User clicks Done in the popup, or the agent calls `end_session`.
- Max session seconds (already enforced, now in the popup).
- Captured track `ended` (user clicks "Stop sharing" or closes the tab).
- Popup closed by the user: no reliable goodbye (none arrived in the test). The server marks the session `abandoned` after N seconds without a chunk or heartbeat and finalises what it has.
- On end: the popup stops all tracks, flushes chunks, `POST /end`, then `window.close()`.

### Server changes
- **Heartbeat / abandoned sessions:** `POST /sessions/{id}/heartbeat` every ~10 s from the popup (chunk uploads also count). A sweeper marks `active` sessions with no signal for ~45 s as `abandoned` and enqueues finalisation. The `abandoned` status exists in the type but nothing sets it yet. This is also what protects against the dev hot-reload cut seen earlier.
- **Page-view events:** extend `/events` with `{pageId, pageSeq, seq, events[]}` and add an event type `page_view {url, title, referrer, navType, tMs}`. Events are stored per page (`events/{pageSeq}-{seq}.ndjson`) because rrweb emits a fresh full snapshot on each page load; the replay player stitches them using `page_view` boundaries.
- **Clock alignment:** the popup returns `startedAt` (its recording start) and the server timestamps arrivals; collectors report `tMs` relative to `startedAt` plus the server's offset, so replay events line up with the video.
- **Context merging:** console errors, failed requests, clicks are per page. Flush on `pagehide` (fetch `keepalive`, only small payloads: keepalive bodies are capped near 64 KB, and our video chunks failed with it in the test) and have `/context` append instead of overwrite. `/end` stops taking the single context blob.
- **Collector token:** `/events` and `/context` accept `collectorToken` (issued at session creation) in addition to the public key and Origin check, so a stray script holding only a session id cannot inject events. The popup's `/sessions/{id}/*` calls use a separate controller token.
- **CORS and origins:** the controller page is served from our origin, so it calls the API same-origin. Collectors keep using the public key + allowed-origin check.

## 7. Open risks

- **Wrong tab or whole screen chosen.** The picker is Chrome's; we can only filter surface types (`displaySurface: "browser"`, monitors excluded, `getSettings().displaySurface` checked). We cannot tell which tab was picked. Cheap check: the collector briefly paints a one-pixel nonce marker and the controller reads it from the captured video before proceeding. Not built or tested.
- **Real picker UX is untested** (a human picks the tab). Users may find "pick the tab you came from" confusing; copy and a screenshot hint matter.
- **Two windows, two clicks.** Conversion drop-off vs the in-page flow is unknown. Measure it.
- **Popup visibility and throttling.** If the popup is minimised or fully covered for minutes, Chrome may throttle timers (frame sampling and heartbeats). Audible tabs are exempt, and during agent audio the popup is audible; not tested.
- **COOP on customer sites** removes the postMessage link (tested). The fallback above degrades replay, not video.
- **Mic permission persistence** for our origin is expected but unverified; first use on each machine still prompts.
- **Same raw-pixel privacy gap** as the in-page mode: `data-private` masks only rrweb, not the video or the frames sent to the model. The popup design does not change it.
- **Safari and Firefox** are untested; Chrome-only matches the MVP scope already proposed.
- **Real OpenAI peer connection** across navigations is expected to behave like the tested loopback but has not been run.

## 8. Sources

- [Document Picture-in-Picture spec](https://wicg.github.io/document-picture-in-picture/): PiP window closes when the opener navigates or is destroyed (section 6.6, 6.7), requires transient activation, top-level only.
- [Chrome extensions: audio recording and screen capture](https://developer.chrome.com/docs/extensions/how-to/web-platform/screen-capture): content-script capture ends on navigation; offscreen document recommended to record across navigations; `tabCapture.getMediaStreamId` in a service worker since Chrome 116.
- [chrome.offscreen API](https://developer.chrome.com/docs/extensions/reference/api/offscreen): reasons (`USER_MEDIA`, `DISPLAY_MEDIA`, `WEB_RTC`, `WORKERS`), no lifetime limit except `AUDIO_PLAYBACK`.
- [MDN: getDisplayMedia()](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia): `selfBrowserSurface`, `surfaceSwitching`, `monitorTypeSurfaces`, `preferCurrentTab`; needs transient activation; permission not persisted.
- [MDN: MediaStreamTrackProcessor](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrackProcessor): dedicated workers only.
- [Userback: recording stops or resets when navigating pages](https://support.userback.io/en/articles/9417968-troubleshoot-recording-stops-or-resets-when-navigating-pages): the widget recording ends on full page load; SPA, extension or custom server-side options.
- [Jam: video screen recording](https://jam.dev/docs/product-features/video-screen-recording): extension records tab, window or desktop.
- [Marker.io: session replay](https://help.marker.io/en/articles/6673880-session-replay): rolling in-page replay; multi-page behaviour not documented.
