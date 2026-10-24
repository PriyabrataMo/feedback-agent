import { record } from "rrweb";
import { connectMock } from "./realtime/mock";
import { connectOpenAI } from "./realtime/openai";
import type { RealtimeClient, RealtimeConnector } from "./realtime/types";
import type { ClientSessionInfo, SessionHandle, SessionOptions, TranscriptSegment } from "./types";

const CHUNK_MS = 5000;
const EVENT_FLUSH_MS = 5000;
const FRAME_CHECK_MS = 1000;
/** Min gap between frames sent to the model; frames are also skipped when the screen hasn't changed. */
const FRAME_MIN_GAP_MS = 4000;
const FRAME_CHANGE_THRESHOLD = 0.04;
const FRAME_WIDTH = 768;

const CONNECTORS: Record<ClientSessionInfo["provider"], RealtimeConnector> = {
  openai: connectOpenAI,
  mock: connectMock,
};

/** Adds every numeric leaf of `src` into `target`, recursing through nested objects. */
function addNumbers(target: Record<string, unknown>, src: Record<string, unknown>) {
  for (const [k, v] of Object.entries(src)) {
    if (typeof v === "number") target[k] = ((target[k] as number) ?? 0) + v;
    else if (v && typeof v === "object" && !Array.isArray(v)) {
      const child = (target[k] ??= {}) as Record<string, unknown>;
      addNumbers(child, v as Record<string, unknown>);
    }
  }
}

export async function runSession(opts: SessionOptions): Promise<SessionHandle> {
  const { apiBase, publicKey, screen, mic, onStatus } = opts;
  const startedAt = Date.now();

  const api = async <T>(path: string, body: unknown): Promise<T> => {
    const res = await fetch(`${apiBase}/api/v1${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Public-Key": publicKey },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
    return res.json() as Promise<T>;
  };

  onStatus("connecting");
  const created = await api<{ sessionId: string; maxSessionSeconds: number; realtime: ClientSessionInfo }>(
    "/sessions",
    { url: location.href, user: opts.user },
  );
  const { sessionId } = created;

  // ---- Recording: screen video + mic + agent voice mixed into one stream -------------------------
  const audioCtx = new AudioContext();
  const mixDest = audioCtx.createMediaStreamDestination();
  audioCtx.createMediaStreamSource(mic).connect(mixDest);
  const recordStream = new MediaStream([...screen.getVideoTracks(), ...mixDest.stream.getAudioTracks()]);

  const mimeType = ["video/webm;codecs=vp8,opus", "video/webm", "video/mp4"].find((t) =>
    MediaRecorder.isTypeSupported(t),
  );
  const recorder = new MediaRecorder(recordStream, { mimeType, videoBitsPerSecond: 600_000 });

  // Chunks upload strictly in order, with retries; closing the tab loses at most the last chunk.
  let uploadChain: Promise<void> = Promise.resolve();
  let chunkSeq = 0;
  let uploadFailures = 0;
  const uploadChunk = async (seq: number, blob: Blob) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const { url } = await api<{ url: string }>(`/sessions/${sessionId}/upload-url`, {
          seq,
          contentType: recorder.mimeType,
        });
        const target = url.startsWith("/") ? apiBase + url : url;
        const res = await fetch(target, { method: "PUT", body: blob, headers: { "Content-Type": recorder.mimeType } });
        if (res.ok) return;
      } catch {
        /* retry */
      }
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
    uploadFailures++;
  };
  recorder.ondataavailable = (e) => {
    if (e.data.size === 0) return;
    const seq = chunkSeq++;
    uploadChain = uploadChain.then(() => uploadChunk(seq, e.data));
  };
  recorder.start(CHUNK_MS);

  // ---- rrweb replay events, flushed in batches ---------------------------------------------------
  let pendingEvents: unknown[] = [];
  let eventSeq = 0;
  const stopRrweb = record({
    emit: (event) => void pendingEvents.push(event),
    maskAllInputs: true,
    blockSelector: "[data-private]",
    maskTextSelector: "[data-private]",
  });
  const flushEvents = async () => {
    if (pendingEvents.length === 0) return;
    const events = pendingEvents;
    pendingEvents = [];
    try {
      await api(`/sessions/${sessionId}/events`, { seq: eventSeq++, events });
    } catch {
      /* replay is best-effort; the recording is the source of truth */
    }
  };
  const eventTimer = setInterval(flushEvents, EVENT_FLUSH_MS);

  // ---- Realtime agent ----------------------------------------------------------------------------
  const transcript: TranscriptSegment[] = [];
  // Summed provider usage (tokens by modality), so real cost per session can be measured.
  const usage: Record<string, unknown> = { responses: 0 };
  let endPromise: Promise<void> | null = null;

  let agent: RealtimeClient | null = null;
  try {
    agent = await CONNECTORS[created.realtime.provider](created.realtime, mic, {
      onTranscript: (s) => {
        const seg = { ...s, at: Date.now() - startedAt };
        transcript.push(seg);
        opts.onTranscript(seg);
      },
      onEndRequested: () => void end("agent"),
      onRemoteStream: (stream) => audioCtx.createMediaStreamSource(stream).connect(mixDest),
      onError: (err) => onStatus("error", err.message),
      onUsage: (u) => {
        addNumbers(usage, u);
        usage.responses = (usage.responses as number) + 1;
      },
    });
  } catch (err) {
    // Without the agent the recording is still useful; surface the error and keep going.
    onStatus("error", err instanceof Error ? err.message : String(err));
  }

  // ---- Screen frames for the agent: downscaled, rate-limited, only when the view changed ---------
  const video = document.createElement("video");
  video.muted = true;
  video.srcObject = new MediaStream(screen.getVideoTracks());
  void video.play().catch(() => {});
  const canvas = document.createElement("canvas");
  const probe = document.createElement("canvas");
  probe.width = 32;
  probe.height = 18;
  let lastProbe: Uint8ClampedArray | null = null;
  let lastFrameAt = 0;

  const frameTimer = setInterval(() => {
    if (!agent || video.videoWidth === 0) return;
    const pctx = probe.getContext("2d", { willReadFrequently: true })!;
    pctx.drawImage(video, 0, 0, probe.width, probe.height);
    const data = pctx.getImageData(0, 0, probe.width, probe.height).data;
    let changed = 1;
    if (lastProbe) {
      let diff = 0;
      for (let i = 0; i < data.length; i += 4) diff += Math.abs(data[i] - lastProbe[i]) / 255;
      changed = diff / (data.length / 4);
    }
    lastProbe = data;
    const due = Date.now() - lastFrameAt >= FRAME_MIN_GAP_MS;
    if (!due || changed < FRAME_CHANGE_THRESHOLD) return;

    canvas.width = FRAME_WIDTH;
    canvas.height = Math.round((FRAME_WIDTH * video.videoHeight) / video.videoWidth);
    canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
    agent.sendFrame(canvas.toDataURL("image/jpeg", 0.6));
    lastFrameAt = Date.now();
  }, FRAME_CHECK_MS);

  // ---- Lifecycle ---------------------------------------------------------------------------------
  const capTimer = setTimeout(() => void end("timeout"), created.maxSessionSeconds * 1000);
  screen.getVideoTracks()[0]?.addEventListener("ended", () => void end("share-stopped"));

  function end(reason: Parameters<SessionHandle["end"]>[0]): Promise<void> {
    if (endPromise) return endPromise;
    console.debug(`[feedback-agent] ending session ${sessionId}: ${reason} after ${Date.now() - startedAt}ms`);
    endPromise = (async () => {
      onStatus("uploading");
      clearTimeout(capTimer);
      clearInterval(frameTimer);
      clearInterval(eventTimer);
      stopRrweb?.();
      agent?.close();

      // Stop capture immediately (privacy: indicators off), then drain remaining uploads.
      if (recorder.state !== "inactive") {
        const stopped = new Promise<void>((r) => recorder.addEventListener("stop", () => r(), { once: true }));
        recorder.stop();
        await stopped;
      }
      for (const t of [...screen.getTracks(), ...mic.getTracks()]) t.stop();
      void audioCtx.close();
      video.srcObject = null;

      await flushEvents();
      await uploadChain;
      try {
        await api(`/sessions/${sessionId}/end`, { transcript, context: opts.getContext(), usage });
        onStatus("done", uploadFailures ? `${uploadFailures} chunk(s) failed to upload` : undefined);
      } catch (err) {
        onStatus("error", err instanceof Error ? err.message : String(err));
      }
    })();
    return endPromise;
  }

  onStatus("listening");
  return { end };
}
