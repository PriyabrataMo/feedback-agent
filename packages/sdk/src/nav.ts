/**
 * SPA navigation detection: patches history.pushState/replaceState and listens to popstate/hashchange.
 * Reference-counted: patches are installed with the first subscriber and restored when the last one leaves
 * (if another library patched on top of ours in the meantime we cannot unwrap safely, so ours just goes inert).
 */

export type NavigationEntry = { from: string; to: string; title: string; at: number };

/**
 * Privacy mask for URLs we store/send: origin + path only. Query strings are dropped entirely (they carry
 * tokens, emails, search terms) and so is the hash, except a route-like hash (`#/settings`, `#!/a/b`) as used
 * by hash routers, which is kept minus any `?query` inside it. Path segments are kept as-is: ids in paths
 * (/invoices/123) are what make a ticket reproducible; customers can hide a page with data-private elements.
 */
export function maskUrl(href: string): string {
  try {
    const u = new URL(href, location.href);
    let out = u.origin + u.pathname;
    if (/^#!?\//.test(u.hash)) out += u.hash.split("?")[0];
    return out.slice(0, 300);
  } catch {
    return "";
  }
}

type Listener = (entry: NavigationEntry) => void;

const listeners = new Set<Listener>();
let teardown: (() => void) | null = null;
let lastHref = "";

const TITLE_SETTLE_MS = 100;

function onChange() {
  const href = location.href;
  if (href === lastHref) return;
  const from = maskUrl(lastHref);
  const to = maskUrl(href);
  lastHref = href;
  // Query-only / non-route-hash changes look identical once masked; nothing useful to report.
  if (from === to) return;
  const at = Date.now();
  // Routers usually update document.title just after the URL changes.
  setTimeout(() => {
    const entry = { from, to, title: document.title.slice(0, 120), at };
    for (const l of [...listeners]) l(entry);
  }, TITLE_SETTLE_MS);
}

function install() {
  lastHref = location.href;
  const origPush = history.pushState;
  const origReplace = history.replaceState;
  let active = true;
  const push = function (this: History, ...args: Parameters<History["pushState"]>) {
    const r = origPush.apply(this, args);
    if (active) onChange();
    return r;
  } as History["pushState"];
  const replace = function (this: History, ...args: Parameters<History["replaceState"]>) {
    const r = origReplace.apply(this, args);
    if (active) onChange();
    return r;
  } as History["replaceState"];
  history.pushState = push;
  history.replaceState = replace;
  addEventListener("popstate", onChange);
  addEventListener("hashchange", onChange);
  return () => {
    active = false;
    if (history.pushState === push) history.pushState = origPush;
    if (history.replaceState === replace) history.replaceState = origReplace;
    removeEventListener("popstate", onChange);
    removeEventListener("hashchange", onChange);
  };
}

/** Subscribes to SPA route changes. Returns an unsubscribe function. */
export function subscribeNavigation(listener: Listener): () => void {
  listeners.add(listener);
  if (!teardown) teardown = install();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && teardown) {
      teardown();
      teardown = null;
    }
  };
}
