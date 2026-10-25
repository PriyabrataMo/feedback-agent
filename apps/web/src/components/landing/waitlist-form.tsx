"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Status = "idle" | "loading" | "success" | "error";

const ERROR_COPY: Record<number, string> = {
  422: "That email address doesn't look right. Check it and try again.",
  429: "Too many attempts. Wait a minute, then try again.",
};
const GENERIC_ERROR =
  "We couldn't add you to the list just now. Try again in a moment.";

/** Basic, non-identifying context sent with the signup so we know where interest comes from. */
function collectTelemetry(shownAt: number | null) {
  const params = new URLSearchParams(window.location.search);
  const utm: Record<string, string> = {};
  for (const key of ["source", "medium", "campaign", "term", "content"]) {
    const value = params.get(`utm_${key}`);
    if (value) utm[key] = value;
  }
  return {
    referrer: document.referrer || null,
    landingPath: window.location.pathname,
    utm,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
    language: navigator.language || null,
    screen: { w: window.screen.width, h: window.screen.height },
    viewport: { w: window.innerWidth, h: window.innerHeight },
    dpr: window.devicePixelRatio || null,
    timeToSubmitMs: shownAt === null ? null : Date.now() - shownAt,
  };
}

/** Email capture. `website` is a honeypot: real people never see or fill it. */
export function WaitlistForm({
  className,
  buttonLabel = "Join the waitlist",
}: {
  className?: string;
  buttonLabel?: string;
}) {
  const uid = useId();
  const inputId = `${uid}-email`;
  const noteId = `${uid}-note`;
  const messageId = `${uid}-message`;
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const shownAt = useRef<number | null>(null);
  useEffect(() => {
    shownAt.current = Date.now();
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === "loading") return;
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const website = String(form.get("website") ?? "");

    setStatus("loading");
    setMessage("");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          source: "landing",
          website,
          telemetry: collectTelemetry(shownAt.current),
        }),
      });
      if (res.ok) {
        setStatus("success");
        return;
      }
      setMessage(ERROR_COPY[res.status] ?? GENERIC_ERROR);
    } catch {
      setMessage(GENERIC_ERROR);
    }
    setStatus("error");
  }

  if (status === "success") {
    return (
      <div
        role="status"
        className={cn(
          "rounded-xl border border-sb-line bg-sb-surface px-5 py-4 text-sb-ink",
          className,
        )}
      >
        <p className="font-display text-lg font-semibold">
          Thanks, you&apos;re in.
        </p>
        <p className="mt-1 text-sm text-sb-soft">
          We&apos;ll email you when early access opens.
        </p>
      </div>
    );
  }

  const busy = status === "loading";
  const failed = status === "error";

  return (
    <form onSubmit={onSubmit} className={className}>
      <label
        htmlFor={inputId}
        className="block text-sm font-medium text-sb-ink"
      >
        Work email
      </label>
      <div className="mt-2 flex flex-col gap-3 sm:flex-row">
        <input
          id={inputId}
          name="email"
          type="email"
          required
          maxLength={254}
          autoComplete="email"
          inputMode="email"
          placeholder="you@company.com"
          disabled={busy}
          aria-invalid={failed || undefined}
          aria-describedby={`${noteId} ${messageId}`}
          className="h-12 w-full min-w-0 rounded-lg sm:flex-1 border border-sb-ink/30 bg-sb-surface px-4 text-base text-sb-ink outline-none placeholder:text-sb-soft/70 focus-visible:border-sb-focus focus-visible:ring-3 focus-visible:ring-sb-focus/40 disabled:opacity-60 aria-invalid:border-sb-rec"
        />
        {/* Honeypot: off-screen, skipped by keyboard and assistive tech. */}
        <div
          aria-hidden="true"
          className="absolute -left-[9999px] h-0 w-0 overflow-hidden"
        >
          <label>
            Leave this field empty
            <input
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              defaultValue=""
            />
          </label>
        </div>
        <Button
          type="submit"
          disabled={busy}
          className="h-12 rounded-lg bg-sb-ink px-6 text-base font-semibold text-sb-paper hover:bg-sb-ink/85 focus-visible:border-sb-focus focus-visible:ring-sb-focus/50"
        >
          {busy ? "Joining…" : buttonLabel}
        </Button>
      </div>
      <p id={noteId} className="mt-3 text-sm text-sb-soft">
        We&apos;ll only use your email to tell you when early access opens. We
        also record your browser, device type and country to understand
        who&apos;s interested. We never store your IP address.
      </p>
      <p
        id={messageId}
        role="alert"
        className={cn("text-sm font-medium text-sb-rec", failed && "mt-2")}
      >
        {failed ? message : ""}
      </p>
    </form>
  );
}
