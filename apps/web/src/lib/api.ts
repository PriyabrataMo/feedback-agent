/** Typed client for the FastAPI backend (apps/api). Server-side only; the browser just plays media. */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type TranscriptSegment = { role: "user" | "agent"; text: string; at: number };

export type Session = {
  id: string;
  projectId: string;
  status: "active" | "ended" | "abandoned";
  url: string;
  userAgent: string;
  endUser: { userId?: string; accountId?: string; plan?: string } | null;
  realtimeProvider: string;
  startedAt: string;
  endedAt: string | null;
  prefix: string;
  transcript: TranscriptSegment[];
  context: { consoleErrors: unknown[]; failedRequests: unknown[]; clicks: unknown[] } | null;
  usage: Record<string, unknown> | null;
};

export type SessionDetail = Session & { mediaChunks: number; replaySegments: number };

async function get<T>(path: string): Promise<T | null> {
  const res = await fetch(`${API_URL}/api/v1${path}`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export async function listSessions(): Promise<Session[]> {
  return (await get<Session[]>("/admin/sessions")) ?? [];
}

export function getSession(id: string): Promise<SessionDetail | null> {
  return get<SessionDetail>(`/admin/sessions/${encodeURIComponent(id)}`);
}

export const mediaUrl = (id: string) => `${API_URL}/api/v1/sessions/${encodeURIComponent(id)}/media`;
