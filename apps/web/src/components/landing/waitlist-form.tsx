"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Status = "idle" | "loading" | "success" | "error";

const ERROR_COPY: Record<number, string> = {
  413: "That request is too long. Shorten the optional note and try again.",
  422: "That email address doesn’t look right. Check it and try again.",
  429: "Too many attempts. Wait a minute, then try again.",
};
const GENERIC_ERROR =
  "We couldn’t add you just now. Please try again in a moment.";

function dimensions(w: number, h: number) {
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) {
    return null;
  }
  return {
    w: Math.min(Math.round(w), 20_000),
    h: Math.min(Math.round(h), 20_000),
  };
}

function collectTelemetry(shownAt: number | null) {
  const params = new URLSearchParams(window.location.search);
  const utm: Record<string, string> = {};
  for (const key of ["source", "medium", "campaign", "term", "content"]) {
    const value = params.get(`utm_${key}`);
    if (value) utm[key] = value.slice(0, 100);
  }
  let timezone: string | null = null;
  try {
    timezone =
      Intl.DateTimeFormat().resolvedOptions().timeZone?.slice(0, 64) || null;
  } catch {
    // Locale data can be unavailable in privacy-restricted browsers.
  }
  const dpr = window.devicePixelRatio;
  return {
    referrer: document.referrer ? document.referrer.slice(0, 300) : null,
    landingPath: window.location.pathname.slice(0, 200),
    utm,
    timezone,
    language: navigator.language?.slice(0, 35) || null,
    screen: dimensions(window.screen.width, window.screen.height),
    viewport: dimensions(window.innerWidth, window.innerHeight),
    dpr: Number.isFinite(dpr) && dpr > 0 ? Math.min(dpr, 10) : null,
    timeToSubmitMs:
      shownAt === null
        ? null
        : Math.min(Math.max(Date.now() - shownAt, 0), 24 * 60 * 60 * 1000),
  };
}

/** Email-first waitlist form with optional design-partner qualification. */
export function WaitlistForm({
  className,
  buttonLabel = "Join the waitlist",
}: {
  className?: string;
  buttonLabel?: string;
}) {
  const uid = useId();
  const emailId = `${uid}-email`;
  const companyId = `${uid}-company`;
  const roleId = `${uid}-role`;
  const workflowId = `${uid}-workflow`;
  const noteId = `${uid}-note`;
  const messageId = `${uid}-message`;
  const shownAt = useRef<number | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [submittedForPilot, setSubmittedForPilot] = useState(false);

  useEffect(() => {
    shownAt.current = Date.now();
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === "loading") return;
    const form = new FormData(event.currentTarget);
    const company = String(form.get("company") ?? "").trim();
    const role = String(form.get("role") ?? "");
    const workflow = String(form.get("workflow") ?? "").trim();
    const hasPilotDetails = Boolean(company || role || workflow);

    setStatus("loading");
    setMessage("");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: String(form.get("email") ?? "").trim(),
          company,
          role,
          workflow,
          source: hasPilotDetails ? "landing-pilot" : "landing-waitlist",
          website: String(form.get("website") ?? ""),
          client: collectTelemetry(shownAt.current),
        }),
      });
      if (res.ok) {
        setSubmittedForPilot(hasPilotDetails);
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
          "rounded-xl border border-sb-mark/70 bg-sb-mark/10 px-5 py-5 text-sb-ink",
          className,
        )}
      >
        <p className="font-display text-xl font-semibold">
          {submittedForPilot ? "Request received." : "You’re on the list."}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-sb-soft">
          {submittedForPilot
            ? "A founder will review your optional pilot details and follow up if there’s a fit."
            : "We’ll email you when early access opens. No account has been created."}
        </p>
      </div>
    );
  }

  const busy = status === "loading";
  const failed = status === "error";
  const fieldClass =
    "min-h-12 w-full rounded-lg border border-sb-ink/35 bg-sb-surface px-4 text-base text-sb-ink outline-none placeholder:text-sb-soft focus-visible:border-sb-focus focus-visible:ring-3 focus-visible:ring-sb-focus/40 disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <form onSubmit={onSubmit} className={cn("space-y-4", className)}>
      <div>
        <label
          htmlFor={emailId}
          className="block text-sm font-semibold text-sb-ink"
        >
          Email address
        </label>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row">
          <input
            id={emailId}
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
            className={cn(fieldClass, "sm:flex-1")}
          />
          <Button
            type="submit"
            disabled={busy}
            className="h-12 shrink-0 rounded-lg bg-sb-ink px-6 text-base font-semibold text-sb-paper hover:bg-sb-ink/85 focus-visible:border-sb-focus focus-visible:ring-sb-focus/50"
          >
            {busy ? "Joining…" : buttonLabel}
          </Button>
        </div>
      </div>

      <details className="group rounded-lg border border-sb-line bg-sb-surface">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-lg px-4 py-3 text-sm font-semibold text-sb-ink outline-none focus-visible:ring-3 focus-visible:ring-sb-focus/40 [&::-webkit-details-marker]:hidden">
          Interested in a design-partner pilot? Add details
          <span
            aria-hidden="true"
            className="text-lg font-normal text-sb-soft transition-transform group-open:rotate-45"
          >
            +
          </span>
        </summary>
        <div className="grid gap-4 border-t border-sb-line p-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor={companyId}
              className="block text-sm font-medium text-sb-ink"
            >
              Company{" "}
              <span className="font-normal text-sb-soft">(optional)</span>
            </label>
            <input
              id={companyId}
              name="company"
              type="text"
              maxLength={120}
              autoComplete="organization"
              placeholder="Acme"
              disabled={busy}
              className={cn(fieldClass, "mt-2")}
            />
          </div>
          <div>
            <label
              htmlFor={roleId}
              className="block text-sm font-medium text-sb-ink"
            >
              Your role{" "}
              <span className="font-normal text-sb-soft">(optional)</span>
            </label>
            <select
              id={roleId}
              name="role"
              defaultValue=""
              disabled={busy}
              className={cn(fieldClass, "mt-2 appearance-none")}
            >
              <option value="">Select a role</option>
              <option value="founder">Founder or executive</option>
              <option value="support">Support or success</option>
              <option value="engineering">Engineering or QA</option>
              <option value="product">Product</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label
              htmlFor={workflowId}
              className="block text-sm font-medium text-sb-ink"
            >
              How do bug reports reach engineering?{" "}
              <span className="font-normal text-sb-soft">(optional)</span>
            </label>
            <textarea
              id={workflowId}
              name="workflow"
              rows={3}
              maxLength={600}
              disabled={busy}
              placeholder="For example: support rewrites Intercom messages in Linear."
              className={cn(fieldClass, "mt-2 resize-y py-3")}
            />
          </div>
        </div>
      </details>

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

      <p id={noteId} className="text-xs leading-relaxed text-sb-soft">
        Email is the only required field. We also store page and campaign
        referral, language/timezone, browser/device, screen/viewport size,
        time-to-submit, and coarse location data to understand interest and
        prevent abuse. Raw IP addresses are not stored.
      </p>
      <p
        id={messageId}
        role="alert"
        aria-live="polite"
        className={cn("text-sm font-medium text-sb-rec", failed && "mt-2")}
      >
        {failed ? message : ""}
      </p>
    </form>
  );
}
