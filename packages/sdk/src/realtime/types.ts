import type { ClientSessionInfo, TranscriptSegment } from "../types";

export type RealtimeHandlers = {
  onTranscript: (segment: Omit<TranscriptSegment, "at">) => void;
  /** The agent said goodbye, called end_session, and its closing audio has finished playing. */
  onEndRequested: () => void;
  /** Remote (agent) audio, so it can be mixed into the recording. */
  onRemoteStream: (stream: MediaStream) => void;
  onError: (error: Error) => void;
  /** Token usage reported by the provider for one finished response (raw provider shape). */
  onUsage: (usage: Record<string, unknown>) => void;
};

export interface RealtimeClient {
  /** Adds a screenshot to the agent's context without prompting a reply. */
  sendFrame(dataUrl: string): void;
  close(): void;
}

export type RealtimeConnector = (
  session: ClientSessionInfo,
  mic: MediaStream,
  handlers: RealtimeHandlers,
) => Promise<RealtimeClient>;
