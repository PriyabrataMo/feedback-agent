import { maskUrl, subscribeNavigation } from "./nav";
import type { PageContext } from "./types";

const MAX_CONSOLE = 50;
const MAX_REQUESTS = 50;
const MAX_CLICKS = 10;
const MAX_NAVIGATIONS = 30;

const push = <T>(arr: T[], item: T, max: number) => {
  arr.push(item);
  if (arr.length > max) arr.shift();
};

const describe = (el: Element): string => {
  const parts: string[] = [];
  for (let node: Element | null = el; node && parts.length < 4; node = node.parentElement) {
    const id = node.id ? `#${node.id}` : "";
    const testId = node.getAttribute("data-testid");
    parts.unshift(`${node.tagName.toLowerCase()}${id}${testId ? `[data-testid=${testId}]` : ""}`);
    if (id) break;
  }
  return parts.join(" > ");
};

/**
 * Installs rolling buffers for console errors, failed requests, clicks and SPA navigations. Runs from page load so the
 * ticket can include what happened *before* the user opened the agent.
 */
export function installContextCollector(isOwnRequest: (url: string) => boolean): () => PageContext {
  const ctx: PageContext = { consoleErrors: [], failedRequests: [], clicks: [], navigations: [] };

  for (const level of ["error", "warn"] as const) {
    const original = console[level];
    console[level] = (...args: unknown[]) => {
      push(
        ctx.consoleErrors,
        { level, message: args.map((a) => (a instanceof Error ? a.stack ?? a.message : String(a))).join(" ").slice(0, 500), at: Date.now() },
        MAX_CONSOLE,
      );
      original.apply(console, args);
    };
  }
  addEventListener("error", (e) =>
    push(ctx.consoleErrors, { level: "uncaught", message: `${e.message} (${e.filename}:${e.lineno})`.slice(0, 500), at: Date.now() }, MAX_CONSOLE),
  );
  addEventListener("unhandledrejection", (e) =>
    push(ctx.consoleErrors, { level: "unhandledrejection", message: String(e.reason).slice(0, 500), at: Date.now() }, MAX_CONSOLE),
  );

  const originalFetch = window.fetch;
  window.fetch = async (...args) => {
    const input = args[0];
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (args[1]?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    try {
      const res = await originalFetch.apply(window, args);
      if (!res.ok && !isOwnRequest(url)) push(ctx.failedRequests, { method, url: url.slice(0, 300), status: res.status, at: Date.now() }, MAX_REQUESTS);
      return res;
    } catch (err) {
      if (!isOwnRequest(url)) push(ctx.failedRequests, { method, url: url.slice(0, 300), status: 0, at: Date.now() }, MAX_REQUESTS);
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
        { selector: describe(el), text: (el.textContent ?? "").trim().slice(0, 60), url: maskUrl(location.href), at: Date.now() },
        MAX_CLICKS,
      );
    },
    { capture: true },
  );

  // SPA route changes, buffered passively from page load (URLs are masked, see nav.ts). The subscription is
  // never dropped: the loader lives as long as the page.
  subscribeNavigation((n) => push(ctx.navigations, { url: n.to, from: n.from, title: n.title, at: n.at }, MAX_NAVIGATIONS));

  return () => structuredClone(ctx);
}
