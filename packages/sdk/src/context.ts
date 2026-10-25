import { maskUrl, subscribeNavigation } from "./nav";
import type { DiagnosticEvent, NetworkEntry, PageContext } from "./types";

const MAX_CONSOLE_LOGS = 100;
const MAX_CONSOLE_ERRORS = 50;
const MAX_NETWORK_REQUESTS = 100;
const MAX_FAILED_REQUESTS = 50;
const MAX_CLICKS = 10;
const MAX_NAVIGATIONS = 30;
const MAX_LOG_LENGTH = 1000;

const push = <T>(arr: T[], item: T, max: number) => {
  arr.push(item);
  if (arr.length > max) arr.shift();
};

const SECRET_KEY =
  /authorization|cookie|password|passwd|secret|token|api[-_]?key|credit[-_]?card/i;
const SECRET_TEXT = [
  /\bBearer\s+[^\s,;]+/gi,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  /\b([\w.+-]+)@([\w-]+\.)+[\w-]{2,}\b/g,
  /\b(authorization|password|passwd|secret|token|api[-_]?key)\s*[:=]\s*["']?[^\s,"';}]+/gi,
] as const;

/** Console arguments are hostile and often contain credentials. Serialize shallowly, redact, and bound them. */
const formatConsole = (args: unknown[]): string => {
  const seen = new WeakSet<object>();
  const depths = new WeakMap<object, number>();
  let visited = 0;
  const replacer = function (this: unknown, key: string, value: unknown) {
    if (key && SECRET_KEY.test(key)) return "[REDACTED]";
    if (typeof value === "string") return value.slice(0, MAX_LOG_LENGTH);
    if (typeof value === "bigint") return String(value);
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) return "[Circular]";
      if (++visited > 100) return "[Truncated]";
      const parentDepth =
        typeof this === "object" && this !== null
          ? (depths.get(this) ?? -1)
          : -1;
      const depth = parentDepth + 1;
      if (depth > 3) return Array.isArray(value) ? "[Array]" : "[Object]";
      seen.add(value);
      depths.set(value, depth);
    }
    return value;
  };
  const text = args
    .map((arg) => {
      if (arg instanceof Error) return arg.stack ?? arg.message;
      if (typeof arg === "string") return arg;
      try {
        const json = JSON.stringify(arg, replacer);
        return json === undefined ? String(arg) : json;
      } catch {
        try {
          return String(arg);
        } catch {
          return "[Unserializable]";
        }
      }
    })
    .join(" ");
  return SECRET_TEXT.reduce(
    (value, pattern) => value.replace(pattern, "[REDACTED]"),
    text,
  ).slice(0, MAX_LOG_LENGTH);
};

type DiagnosticListener = (event: DiagnosticEvent) => void;
const diagnosticListeners = new Set<DiagnosticListener>();

const emitDiagnostic = (event: DiagnosticEvent) => {
  for (const listener of [...diagnosticListeners]) {
    try {
      listener(event);
    } catch {
      /* diagnostics must never interfere with the host application */
    }
  }
};

/** Feeds every entry captured while a session is active; rolling buffers separately retain pre-session context. */
export function subscribeDiagnostics(listener: DiagnosticListener): () => void {
  diagnosticListeners.add(listener);
  return () => diagnosticListeners.delete(listener);
}

const requestUrl = (value: string): string => maskUrl(value);

const describe = (el: Element): string => {
  const parts: string[] = [];
  for (
    let node: Element | null = el;
    node && parts.length < 4;
    node = node.parentElement
  ) {
    const id = node.id ? `#${node.id}` : "";
    const testId = node.getAttribute("data-testid");
    parts.unshift(
      `${node.tagName.toLowerCase()}${id}${testId ? `[data-testid=${testId}]` : ""}`,
    );
    if (id) break;
  }
  return parts.join(" > ");
};

/**
 * Installs rolling buffers for console output, fetch/XHR metadata, clicks and SPA navigations. Runs from page load so
 * the ticket can include what happened *before* the user opened the agent. Network bodies, headers and URL query/hash
 * are deliberately never captured.
 */
export function installContextCollector(
  isOwnRequest: (url: string) => boolean,
): () => PageContext {
  const ctx: PageContext = {
    consoleLogs: [],
    networkRequests: [],
    consoleErrors: [],
    failedRequests: [],
    clicks: [],
    navigations: [],
  };

  const captureConsole = (level: string, args: unknown[]) => {
    const entry = { level, message: formatConsole(args), at: Date.now() };
    push(ctx.consoleLogs, entry, MAX_CONSOLE_LOGS);
    if (!(["debug", "log", "info"] as string[]).includes(level)) {
      push(ctx.consoleErrors, entry, MAX_CONSOLE_ERRORS);
    }
    emitDiagnostic({ kind: "console", entry });
  };
  for (const level of ["debug", "log", "info", "warn", "error"] as const) {
    const original = console[level];
    console[level] = (...args: unknown[]) => {
      try {
        captureConsole(level, args);
      } catch {
        /* diagnostics must never interfere with the host console */
      }
      original.apply(console, args);
    };
  }
  addEventListener("error", (e) =>
    captureConsole("uncaught", [
      `${e.message} (${requestUrl(e.filename)}:${e.lineno})`,
    ]),
  );
  addEventListener("unhandledrejection", (e) =>
    captureConsole("unhandledrejection", [e.reason]),
  );

  const captureRequest = (entry: NetworkEntry) => {
    if (!entry.url) return;
    push(ctx.networkRequests, entry, MAX_NETWORK_REQUESTS);
    if (entry.status === 0 || entry.status >= 400)
      push(ctx.failedRequests, entry, MAX_FAILED_REQUESTS);
    emitDiagnostic({ kind: "network", entry });
  };

  const originalFetch = window.fetch;
  window.fetch = async (...args) => {
    const input = args[0];
    const rawUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const method = (
      args[1]?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    const absoluteUrl = new URL(rawUrl, location.href).href;
    const started = performance.now();
    try {
      const res = await originalFetch.apply(window, args);
      if (!isOwnRequest(absoluteUrl)) {
        captureRequest({
          type: "fetch",
          method,
          url: requestUrl(absoluteUrl),
          status: res.status,
          durationMs: Math.round(performance.now() - started),
          at: Date.now(),
        });
      }
      return res;
    } catch (err) {
      if (!isOwnRequest(absoluteUrl)) {
        captureRequest({
          type: "fetch",
          method,
          url: requestUrl(absoluteUrl),
          status: 0,
          durationMs: Math.round(performance.now() - started),
          at: Date.now(),
        });
      }
      throw err;
    }
  };

  // XHR is still common in older apps and in libraries such as Axios. Capture only completion metadata.
  const originalXhrOpen = XMLHttpRequest.prototype.open;
  const originalXhrSend = XMLHttpRequest.prototype.send;
  const xhrMeta = new WeakMap<
    XMLHttpRequest,
    { method: string; url: string }
  >();
  const xhrOpen = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    async: boolean = true,
    username?: string | null,
    password?: string | null,
  ) {
    xhrMeta.set(this, {
      method: method.toUpperCase(),
      url: new URL(String(url), location.href).href,
    });
    return originalXhrOpen.call(this, method, url, async, username, password);
  };
  XMLHttpRequest.prototype.open =
    xhrOpen as typeof XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.send = function (
    this: XMLHttpRequest,
    ...args: Parameters<XMLHttpRequest["send"]>
  ) {
    const meta = xhrMeta.get(this);
    if (!meta || isOwnRequest(meta.url))
      return originalXhrSend.apply(this, args);
    const started = performance.now();
    let captured = false;
    const complete = () => {
      if (captured) return;
      captured = true;
      captureRequest({
        type: "xhr",
        method: meta.method,
        url: requestUrl(meta.url),
        status: this.status,
        durationMs: Math.round(performance.now() - started),
        at: Date.now(),
      });
    };
    this.addEventListener("loadend", complete, { once: true });
    try {
      return originalXhrSend.apply(this, args);
    } catch (err) {
      complete();
      throw err;
    }
  };

  addEventListener(
    "click",
    (e) => {
      const el = e.target instanceof Element ? e.target : null;
      if (!el || el.closest("[data-private]")) return;
      push(
        ctx.clicks,
        {
          selector: describe(el),
          text: (el.textContent ?? "").trim().slice(0, 60),
          url: maskUrl(location.href),
          at: Date.now(),
        },
        MAX_CLICKS,
      );
    },
    { capture: true },
  );

  // SPA route changes, buffered passively from page load (URLs are masked, see nav.ts). The subscription is
  // never dropped: the loader lives as long as the page.
  subscribeNavigation((n) =>
    push(
      ctx.navigations,
      { url: n.to, from: n.from, title: n.title, at: n.at },
      MAX_NAVIGATIONS,
    ),
  );

  return () => structuredClone(ctx);
}
