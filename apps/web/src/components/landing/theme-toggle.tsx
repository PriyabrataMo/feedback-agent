"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";

const STORAGE_KEY = "showbug-theme";
const CHANGE_EVENT = "showbug-theme-change";

type Theme = "light" | "dark";

/** The theme in effect: the visitor's explicit pick (data-theme) or else the OS setting. */
function currentTheme(): Theme {
  const picked = document.documentElement.dataset.theme;
  if (picked === "light" || picked === "dark") return picked;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function subscribe(onChange: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    media.removeEventListener("change", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

/** Light/dark switch. The pre-paint script in layout.tsx restores the saved choice before first render. */
export function ThemeToggle() {
  // null on the server and during hydration, so the markup always matches.
  const theme = useSyncExternalStore<Theme | null>(
    subscribe,
    currentTheme,
    () => null,
  );

  function toggle() {
    const next: Theme = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage blocked (private mode): the choice still applies for this visit.
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }

  const toLight = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={theme === null}
      aria-label={toLight ? "Switch to light theme" : "Switch to dark theme"}
      title={toLight ? "Switch to light theme" : "Switch to dark theme"}
      className="grid size-10 shrink-0 place-items-center rounded-lg border border-sb-ink/30 text-sb-ink outline-none hover:bg-sb-surface focus-visible:ring-3 focus-visible:ring-sb-focus/60"
    >
      {theme === null ? null : toLight ? (
        <Sun className="size-5" aria-hidden="true" />
      ) : (
        <Moon className="size-5" aria-hidden="true" />
      )}
    </button>
  );
}
