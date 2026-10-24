/** Pure helpers for the replay timeline: no React, no DOM, so they are easy to reason about. */

export type ReplayEvent = { type: number; timestamp: number; data?: unknown };

export type TimelineKind = "navigation" | "console-error" | "failed-request";

export type TimelineItem = {
  kind: TimelineKind;
  /** ms from the first replay event (clamped at 0). */
  offset: number;
  title: string;
  detail?: string;
};

export type PageContext = {
  consoleErrors?: unknown[];
  failedRequests?: unknown[];
  clicks?: unknown[];
  navigations?: unknown[];
} | null;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

export function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Keeps only plausible rrweb events (an object with numeric type and timestamp). */
export function sanitizeEvents(raw: unknown): ReplayEvent[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (e): e is ReplayEvent => isRecord(e) && typeof e.type === "number" && typeof e.timestamp === "number",
  );
}

/** A replay needs a full snapshot (type 2) and at least two events. */
export function isReplayable(events: ReplayEvent[]): boolean {
  return events.length >= 2 && events.some((e) => e.type === 2);
}

function navigationsFromEvents(events: ReplayEvent[], t0: number): TimelineItem[] {
  const out: TimelineItem[] = [];
  for (const e of events) {
    // rrweb custom event: { type: 5, data: { tag: "navigation", payload: { from, to, title } } }
    if (e.type !== 5 || !isRecord(e.data) || e.data.tag !== "navigation" || !isRecord(e.data.payload)) continue;
    const p = e.data.payload;
    const to = str(p.to) ?? str(p.url) ?? str(p.href);
    if (!to) continue;
    out.push({
      kind: "navigation",
      offset: Math.max(0, e.timestamp - t0),
      title: to,
      detail: [str(p.title), str(p.from) ? `from ${str(p.from)}` : undefined].filter(Boolean).join(" · ") || undefined,
    });
  }
  return out;
}

/**
 * Builds the sorted timeline. `t0` is the epoch ms that replay time 0 corresponds to (the first replay event);
 * context entries carry epoch-ms `at` values from the same browser clock.
 */
export function buildTimeline(events: ReplayEvent[], context: PageContext, t0: number): TimelineItem[] {
  const items: TimelineItem[] = [];

  let navs = navigationsFromEvents(events, t0);
  if (navs.length === 0 && context && Array.isArray(context.navigations)) {
    navs = context.navigations.flatMap((n): TimelineItem[] => {
      if (!isRecord(n)) return [];
      const to = str(n.url) ?? str(n.to) ?? str(n.href);
      const at = num(n.at);
      if (!to || at === undefined) return [];
      return [
        {
          kind: "navigation",
          offset: Math.max(0, at - t0),
          title: to,
          detail: [str(n.title), str(n.from) ? `from ${str(n.from)}` : undefined].filter(Boolean).join(" · ") || undefined,
        },
      ];
    });
  }
  items.push(...navs);

  for (const e of context?.consoleErrors ?? []) {
    if (!isRecord(e)) continue;
    const at = num(e.at);
    if (at === undefined) continue;
    items.push({ kind: "console-error", offset: Math.max(0, at - t0), title: str(e.message) ?? "Console error" });
  }
  for (const r of context?.failedRequests ?? []) {
    if (!isRecord(r)) continue;
    const at = num(r.at);
    if (at === undefined) continue;
    const status = num(r.status);
    items.push({
      kind: "failed-request",
      offset: Math.max(0, at - t0),
      title: `${str(r.method) ?? "GET"} ${str(r.url) ?? "(unknown url)"}`,
      detail: status !== undefined ? `Status ${status}` : str(r.error),
    });
  }
  return items.sort((a, b) => a.offset - b.offset);
}

/** Index of the last entry whose offset is <= `ms`, or -1. `offsets` must be ascending. */
export function activeIndex(offsets: number[], ms: number): number {
  let idx = -1;
  for (let i = 0; i < offsets.length; i++) {
    if (offsets[i] <= ms) idx = i;
    else break;
  }
  return idx;
}

/** Normalises ticket repro steps, which may arrive as strings or small objects. */
export function normalizeSteps(steps: unknown): string[] {
  if (!Array.isArray(steps)) return [];
  return steps.flatMap((s) => {
    if (typeof s === "string") return s.trim() ? [s] : [];
    if (isRecord(s)) {
      const t = str(s.text) ?? str(s.step) ?? str(s.description) ?? str(s.action);
      return t ? [t] : [];
    }
    return [];
  });
}
