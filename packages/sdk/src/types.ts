export type EndUser = { userId?: string; accountId?: string; plan?: string };

export type TranscriptSegment = { role: "user" | "agent"; text: string; at: number };

/** Passive page context kept in a rolling window from the moment the loader runs. */
export type PageContext = {
  consoleErrors: { level: string; message: string; at: number }[];
  failedRequests: { method: string; url: string; status: number; at: number }[];
  clicks: { selector: string; text: string; url?: string; at: number }[];
  /** SPA route changes (masked URLs: origin + path, no query/hash). `url` is the destination. */
  navigations: { url: string; from: string; title: string; at: number }[];
};

/** Shape returned by POST /api/v1/sessions (mirrors apps/web ClientSession). */
export type ClientSessionInfo = {
  provider: "openai" | "mock";
  model: string;
  clientSecret: string;
  expiresAt: number;
  connectUrl: string;
  instructions: string;
};

export type SessionStatus = "connecting" | "listening" | "wrapping-up" | "uploading" | "done" | "error";

export type SessionOptions = {
  apiBase: string;
  publicKey: string;
  user: EndUser | null;
  screen: MediaStream;
  mic: MediaStream;
  getContext: () => PageContext;
  /** SPA navigation feed from the loader (so session.js needn't bundle its own history patch). */
  subscribeNavigation?: (listener: (n: { from: string; to: string; title: string; at: number }) => void) => () => void;
  onStatus: (status: SessionStatus, detail?: string) => void;
  onTranscript: (segment: TranscriptSegment) => void;
};

export type SessionHandle = {
  /** Ends the session (idempotent). Resolves once uploads have drained and the server has been told. */
  end: (reason: "user" | "agent" | "timeout" | "share-stopped") => Promise<void>;
};
