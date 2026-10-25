import { installContextCollector, subscribeDiagnostics } from "./context";
import { subscribeNavigation } from "./nav";
import type {
  EndUser,
  SessionHandle,
  SessionStatus,
  TranscriptSegment,
} from "./types";

/**
 * Tiny classic-script entry: <script src=".../sdk/loader.js" data-key="pk_..." data-api="https://api..."></script>
 * Renders the button, keeps passive page context, and only fetches the heavy session module
 * (rrweb, recorder, realtime) when someone clicks.
 */
const script = document.currentScript as HTMLScriptElement | null;
const publicKey = script?.dataset.key;
const scriptUrl = script?.src ? new URL(script.src) : null;

if (!publicKey || !scriptUrl) {
  console.warn("[feedback-agent] missing data-key on the script tag");
} else {
  // The API lives on its own origin (FastAPI); data-api overrides the default of the script's own origin.
  const apiBase = script?.dataset.api?.replace(/\/$/, "") || scriptUrl.origin;
  const sessionModuleUrl = new URL("session.js", scriptUrl).href;
  const getContext = installContextCollector((url) =>
    url.startsWith(apiBase + "/api/v1"),
  );

  let user: EndUser | null = null;
  (window as any).FeedbackAgent = {
    identify(u: EndUser) {
      user = u;
    },
  };

  const host = document.createElement("div");
  host.setAttribute("data-private", "");
  host.style.cssText =
    "position:fixed;right:20px;bottom:20px;z-index:2147483647;";
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; font-family: system-ui, -apple-system, sans-serif; }
      button { cursor: pointer; border: 0; border-radius: 999px; font-size: 14px; }
      .fab { background: #111; color: #fff; padding: 12px 18px; box-shadow: 0 4px 14px rgba(0,0,0,.25); }
      .panel { width: 320px; background: #fff; color: #111; border: 1px solid #ddd; border-radius: 14px; padding: 14px; box-shadow: 0 8px 28px rgba(0,0,0,.2); }
      .panel h4 { margin: 0 0 4px; font-size: 14px; }
      .consent { font-size: 12px; color: #555; margin: 6px 0 12px; line-height: 1.4; }
      .row { display: flex; gap: 8px; }
      .primary { background: #111; color: #fff; padding: 9px 14px; }
      .ghost { background: #eee; color: #111; padding: 9px 14px; }
      .status { font-size: 12px; color: #555; margin-bottom: 8px; }
      .log { max-height: 180px; overflow: auto; font-size: 13px; margin-bottom: 10px; }
      .log p { margin: 4px 0; }
      .log .agent { color: #0a5; }
      .dot { display:inline-block; width:8px; height:8px; border-radius:50%; background:#e22; margin-right:6px; animation: pulse 1.2s infinite; }
      @keyframes pulse { 50% { opacity: .3; } }
      [hidden] { display: none !important; }
    </style>
    <button class="fab" part="fab">Report a problem</button>
    <div class="panel" hidden>
      <div class="intro">
        <h4>Tell us what went wrong</h4>
        <p class="consent">You'll be asked to share this tab and your microphone. A voice assistant (powered by an AI provider) will ask a few questions. Your screen video, audio, a replay of the page, and recent console/network diagnostics are recorded so the team can fix the problem. Network bodies, headers, and URL query values are not recorded. Fields marked private are hidden from the replay only, not from the video.</p>
        <div class="row"><button class="primary start">Start</button><button class="ghost cancel">Cancel</button></div>
      </div>
      <div class="live" hidden>
        <div class="status"></div>
        <div class="log"></div>
        <div class="row"><button class="primary done">Done</button></div>
      </div>
    </div>`;
  document.documentElement.append(host);

  const $ = <T extends Element>(sel: string) => root.querySelector<T>(sel)!;
  const fab = $<HTMLButtonElement>(".fab");
  const panel = $<HTMLDivElement>(".panel");
  const intro = $<HTMLDivElement>(".intro");
  const live = $<HTMLDivElement>(".live");
  const statusEl = $<HTMLDivElement>(".status");
  const log = $<HTMLDivElement>(".log");
  const doneBtn = $<HTMLButtonElement>(".done");

  const reset = () => {
    panel.hidden = true;
    fab.hidden = false;
    intro.hidden = false;
    live.hidden = true;
    log.textContent = "";
    doneBtn.disabled = false;
  };

  const LABELS: Record<SessionStatus, string> = {
    connecting: "Connecting…",
    listening: '<span class="dot"></span>Recording. Describe the problem.',
    "wrapping-up": "Wrapping up…",
    uploading: "Saving your report…",
    done: "Thank you! Your report was sent.",
    error: "Something went wrong.",
  };

  const addLine = (s: TranscriptSegment) => {
    const p = document.createElement("p");
    p.className = s.role;
    p.textContent = s.text;
    log.append(p);
    log.scrollTop = log.scrollHeight;
  };

  fab.addEventListener("click", () => {
    fab.hidden = true;
    panel.hidden = false;
  });
  $(".cancel").addEventListener("click", reset);

  $<HTMLButtonElement>(".start").addEventListener("click", async () => {
    // getDisplayMedia needs the click's transient user activation, so it must be the first await.
    let screen: MediaStream | undefined;
    let mic: MediaStream;
    try {
      screen = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: "browser" },
        audio: false,
        preferCurrentTab: true,
      } as DisplayMediaStreamOptions);
      mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      // If the mic was refused after the screen was granted, don't leave "Sharing this tab" running.
      screen?.getTracks().forEach((t) => t.stop());
      reset();
      return;
    }
    // Hints only: a window/whole-screen share can't be covered by our DOM masking, so require a tab.
    if (
      screen.getVideoTracks()[0]?.getSettings().displaySurface !== undefined &&
      screen.getVideoTracks()[0].getSettings().displaySurface !== "browser"
    ) {
      [...screen.getTracks(), ...mic.getTracks()].forEach((t) => t.stop());
      reset();
      return;
    }

    intro.hidden = true;
    live.hidden = false;
    let handle: SessionHandle | null = null;
    let detail = "";
    const setStatus = (status: SessionStatus, d?: string) => {
      detail = d ?? "";
      statusEl.innerHTML = LABELS[status] + (detail ? ` <em></em>` : "");
      if (detail) statusEl.querySelector("em")!.textContent = `(${detail})`;
      if (status === "done") setTimeout(reset, 3000);
      if (status === "uploading" || status === "done") doneBtn.disabled = true;
    };

    try {
      const mod: typeof import("./session") = await import(
        /* webpackIgnore: true */ sessionModuleUrl
      );
      handle = await mod.runSession({
        apiBase,
        publicKey,
        user,
        screen,
        mic,
        getContext,
        subscribeNavigation,
        subscribeDiagnostics,
        onStatus: setStatus,
        onTranscript: addLine,
      });
    } catch (err) {
      for (const t of [...screen.getTracks(), ...mic.getTracks()]) t.stop();
      setStatus("error", err instanceof Error ? err.message : String(err));
      setTimeout(reset, 4000);
      return;
    }
    doneBtn.onclick = () => void handle!.end("user");
  });
}
