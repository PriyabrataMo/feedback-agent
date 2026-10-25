/** Pure helpers for the replay timeline: no React, no DOM, so they are easy to reason about. */

export type ReplayEvent = { type: number; timestamp: number; data?: unknown };

export type TimelineKind =
  | "navigation"
  | "console-log"
  | "console-error"
  | "network-request"
  | "failed-request";

export type TimelineItem = {
  kind: TimelineKind;
  /** ms from the first replay event (clamped at 0). */
  offset: number;
  title: string;
  detail?: string;
};

export type PageContext = {
  consoleLogs?: unknown[];
  networkRequests?: unknown[];
  consoleErrors?: unknown[];
  failedRequests?: unknown[];
  clicks?: unknown[];
  navigations?: unknown[];
} | null;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;
const str = (v: unknown): string | undefined =>
  typeof v === "string" && v ? v : undefined;
const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

export function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Keeps only plausible rrweb events (an object with numeric type and timestamp). */
export function sanitizeEvents(raw: unknown): ReplayEvent[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (e): e is ReplayEvent =>
      isRecord(e) &&
      typeof e.type === "number" &&
      typeof e.timestamp === "number",
  );
}

/** A replay needs a full snapshot (type 2) and at least two events. */
export function isReplayable(events: ReplayEvent[]): boolean {
  return events.length >= 2 && events.some((e) => e.type === 2);
}

function navigationsFromEvents(
  events: ReplayEvent[],
  t0: number,
): TimelineItem[] {
  const out: TimelineItem[] = [];
  for (const e of events) {
    // rrweb custom event: { type: 5, data: { tag: "navigation", payload: { from, to, title } } }
    if (
      e.type !== 5 ||
      !isRecord(e.data) ||
      e.data.tag !== "navigation" ||
      !isRecord(e.data.payload)
    )
      continue;
    const p = e.data.payload;
    const to = str(p.to) ?? str(p.url) ?? str(p.href);
    if (!to) continue;
    out.push({
      kind: "navigation",
      offset: Math.max(0, e.timestamp - t0),
      title: to,
      detail:
        [str(p.title), str(p.from) ? `from ${str(p.from)}` : undefined]
          .filter(Boolean)
          .join(" · ") || undefined,
    });
  }
  return out;
}

function diagnosticKey(
  entry: Record<string, unknown>,
  fields: string[],
): string {
  return fields.map((field) => String(entry[field] ?? "")).join("\u0000");
}

function diagnosticsFromEvents(events: ReplayEvent[], t0: number) {
  const items: TimelineItem[] = [];
  const consoleKeys = new Set<string>();
  const requestKeys = new Set<string>();
  for (const event of events) {
    if (
      event.type !== 5 ||
      !isRecord(event.data) ||
      !isRecord(event.data.payload)
    )
      continue;
    const entry = event.data.payload;
    if (event.data.tag === "diagnostic:console") {
      const message = str(entry.message) ?? "Console message";
      const level = str(entry.level) ?? "log";
      consoleKeys.add(diagnosticKey(entry, ["level", "message", "at"]));
      items.push({
        kind: ["debug", "log", "info"].includes(level)
          ? "console-log"
          : "console-error",
        offset: Math.max(0, event.timestamp - t0),
        title: message,
        detail: level,
      });
    } else if (event.data.tag === "diagnostic:network") {
      const method = str(entry.method) ?? "GET";
      const url = str(entry.url) ?? "(unknown url)";
      const status = num(entry.status) ?? 0;
      const duration = num(entry.durationMs);
      requestKeys.add(
        diagnosticKey(entry, [
          "type",
          "method",
          "url",
          "status",
          "durationMs",
          "at",
        ]),
      );
      items.push({
        kind:
          status === 0 || status >= 400 ? "failed-request" : "network-request",
        offset: Math.max(0, event.timestamp - t0),
        title: `${method} ${url}`,
        detail: [
          status ? `Status ${status}` : "Network error",
          duration === undefined ? undefined : `${duration} ms`,
          str(entry.type)?.toUpperCase(),
        ]
          .filter(Boolean)
          .join(" · "),
      });
    }
  }
  return { items, consoleKeys, requestKeys };
}

/**
 * Builds the sorted timeline. `t0` is the epoch ms that replay time 0 corresponds to (the first replay event);
 * context entries carry epoch-ms `at` values from the same browser clock.
 */
export function buildTimeline(
  events: ReplayEvent[],
  context: PageContext,
  t0: number,
): TimelineItem[] {
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
          detail:
            [str(n.title), str(n.from) ? `from ${str(n.from)}` : undefined]
              .filter(Boolean)
              .join(" · ") || undefined,
        },
      ];
    });
  }
  items.push(...navs);

  const diagnostics = diagnosticsFromEvents(events, t0);
  items.push(...diagnostics.items);

  for (const e of context?.consoleLogs ?? context?.consoleErrors ?? []) {
    if (!isRecord(e)) continue;
    const at = num(e.at);
    if (at === undefined) continue;
    if (
      diagnostics.consoleKeys.has(diagnosticKey(e, ["level", "message", "at"]))
    )
      continue;
    const level = str(e.level) ?? "log";
    items.push({
      kind: ["debug", "log", "info"].includes(level)
        ? "console-log"
        : "console-error",
      offset: Math.max(0, at - t0),
      title: str(e.message) ?? "Console message",
      detail: level,
    });
  }
  for (const r of context?.networkRequests ?? context?.failedRequests ?? []) {
    if (!isRecord(r)) continue;
    const at = num(r.at);
    if (at === undefined) continue;
    if (
      diagnostics.requestKeys.has(
        diagnosticKey(r, [
          "type",
          "method",
          "url",
          "status",
          "durationMs",
          "at",
        ]),
      )
    )
      continue;
    const status = num(r.status);
    const duration = num(r.durationMs);
    items.push({
      kind:
        status === 0 || (status !== undefined && status >= 400)
          ? "failed-request"
          : "network-request",
      offset: Math.max(0, at - t0),
      title: `${str(r.method) ?? "GET"} ${str(r.url) ?? "(unknown url)"}`,
      detail: [
        status
          ? `Status ${status}`
          : status === 0
            ? "Network error"
            : str(r.error),
        duration === undefined ? undefined : `${duration} ms`,
        str(r.type)?.toUpperCase(),
      ]
        .filter(Boolean)
        .join(" · "),
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
      const t =
        str(s.text) ?? str(s.step) ?? str(s.description) ?? str(s.action);
      return t ? [t] : [];
    }
    return [];
  });
}
