import type { RealtimeConnector } from "./types";

/** No model: greets with speechSynthesis and relies on the Done button. For plumbing tests without a key. */
export const connectMock: RealtimeConnector = async (_session, _mic, handlers) => {
  const greeting = "Hello! What problem are you running into?";
  if ("speechSynthesis" in window) speechSynthesis.speak(new SpeechSynthesisUtterance(greeting));
  handlers.onTranscript({ role: "agent", text: greeting });
  return {
    sendFrame() {},
    close() {
      if ("speechSynthesis" in window) speechSynthesis.cancel();
    },
  };
};
