import type { RealtimeConnector } from "./types";

/** Waits for the agent's closing line to finish playing before honouring end_session. */
const END_FALLBACK_MS = 6000;

export const connectOpenAI: RealtimeConnector = async (session, mic, handlers, initialFrame) => {
  const pc = new RTCPeerConnection();

  const audioEl = new Audio();
  audioEl.autoplay = true;
  pc.ontrack = (e) => {
    audioEl.srcObject = e.streams[0];
    handlers.onRemoteStream(e.streams[0]);
  };

  for (const track of mic.getAudioTracks()) pc.addTrack(track, mic);

  const channel = pc.createDataChannel("oai-events");
  const send = (event: unknown) => {
    if (channel.readyState === "open") channel.send(JSON.stringify(event));
  };

  let endPending = false;
  let endRequested = false;
  const requestEnd = () => {
    if (endRequested) return;
    endRequested = true;
    handlers.onEndRequested();
  };

  channel.onmessage = (msg) => {
    let ev: any;
    try {
      ev = JSON.parse(msg.data);
    } catch {
      return;
    }
    switch (ev.type) {
      case "conversation.item.input_audio_transcription.completed":
        if (ev.transcript?.trim()) handlers.onTranscript({ role: "user", text: ev.transcript.trim() });
        break;
      // GA name first, beta name as fallback.
      case "response.output_audio_transcript.done":
      case "response.audio_transcript.done":
        if (ev.transcript?.trim()) handlers.onTranscript({ role: "agent", text: ev.transcript.trim() });
        break;
      case "response.done": {
        if (ev.response?.usage) {
          console.debug("[feedback-agent] response usage", JSON.stringify(ev.response.usage));
          handlers.onUsage(ev.response.usage);
        }
        const items: any[] = ev.response?.output ?? [];
        if (items.some((i) => i.type === "function_call" && i.name === "end_session")) {
          // Generation finishes before playback does; end once the audio buffer drains (or on timeout).
          console.debug("[feedback-agent] model called end_session");
          endPending = true;
          setTimeout(requestEnd, END_FALLBACK_MS);
        }
        break;
      }
      case "output_audio_buffer.stopped":
        if (endPending) requestEnd();
        break;
      case "error":
        console.debug("[feedback-agent] realtime error event", JSON.stringify(ev.error));
        handlers.onError(new Error(ev.error?.message ?? "realtime error"));
        break;
    }
  };

  const opened = new Promise<void>((resolve, reject) => {
    channel.onopen = () => resolve();
    setTimeout(() => reject(new Error("realtime connection timed out")), 15000);
  });

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  const res = await fetch(session.connectUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.clientSecret}`, "Content-Type": "application/sdp" },
    body: offer.sdp,
  });
  if (!res.ok) throw new Error(`realtime handshake failed: ${res.status}`);
  await pc.setRemoteDescription({ type: "answer", sdp: await res.text() });
  await opened;

  const sendFrame = (dataUrl: string) =>
    send({
      type: "conversation.item.create",
      item: { type: "message", role: "user", content: [{ type: "input_image", image_url: dataUrl }] },
    });

  // Put the first screen frame in the conversation before the agent speaks, so its greeting can already
  // reference the page. The frame promise is bounded by the session (null on timeout).
  const first = await initialFrame;
  if (first) {
    sendFrame(first);
    console.debug(`[feedback-agent] initial frame sent (${Math.round(first.length / 1024)} KB) before greeting`);
  } else {
    console.debug("[feedback-agent] no initial frame available; greeting without screen");
  }
  // Make the agent speak first.
  send({ type: "response.create" });

  return {
    sendFrame,
    close() {
      channel.close();
      pc.close();
      audioEl.srcObject = null;
    },
  };
};
