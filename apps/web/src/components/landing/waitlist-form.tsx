"use client";

import { useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Status = "idle" | "loading" | "success" | "error";

const ERROR_COPY: Record<number, string> = {
  413: "That request is too long. Shorten the workflow note and try again.",
  422: "Check the highlighted details and try again.",
  429: "Too many attempts. Wait a minute, then try again.",
};
const GENERIC_ERROR =
  "We couldn’t send your request just now. Try again in a moment.";

/** Pilot request form. `website` is a honeypot: real people never see or fill it. */
export function WaitlistForm({
  className,
  buttonLabel = "Request a pilot",
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
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === "loading") return;
    const form = new FormData(event.currentTarget);

    setStatus("loading");
    setMessage("");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: String(form.get("email") ?? "").trim(),
          company: String(form.get("company") ?? "").trim(),
          role: String(form.get("role") ?? ""),
          workflow: String(form.get("workflow") ?? "").trim(),
          source: "landing-pilot",
          website: String(form.get("website") ?? ""),
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
          "rounded-xl border border-sb-mark/70 bg-sb-mark/10 px-5 py-5 text-sb-ink",
          className,
        )}
      >
        <p className="font-display text-xl font-semibold">Request received.</p>
        <p className="mt-2 text-sm leading-relaxed text-sb-soft">
          A founder will review the details and email you if your workflow fits
          the current pilot scope.
        </p>
      </div>
    );
  }

  const busy = status === "loading";
  const failed = status === "error";
  const fieldClass =
    "mt-2 min-h-12 w-full rounded-lg border border-sb-ink/30 bg-sb-surface px-4 text-base text-sb-ink outline-none placeholder:text-sb-soft/70 focus-visible:border-sb-focus focus-visible:ring-3 focus-visible:ring-sb-focus/40 disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <form onSubmit={onSubmit} className={cn("space-y-5", className)}>
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label
            htmlFor={emailId}
            className="block text-sm font-medium text-sb-ink"
          >
            Work email <span aria-hidden="true">*</span>
          </label>
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
            className={fieldClass}
          />
        </div>
        <div>
          <label
            htmlFor={companyId}
            className="block text-sm font-medium text-sb-ink"
          >
            Company <span aria-hidden="true">*</span>
          </label>
          <input
            id={companyId}
            name="company"
            type="text"
            required
            maxLength={120}
            autoComplete="organization"
            placeholder="Acme"
            disabled={busy}
            aria-invalid={failed || undefined}
            aria-describedby={messageId}
            className={fieldClass}
          />
        </div>
      </div>

      <div>
        <label
          htmlFor={roleId}
          className="block text-sm font-medium text-sb-ink"
        >
          Your role <span aria-hidden="true">*</span>
        </label>
        <select
          id={roleId}
          name="role"
          required
          defaultValue=""
          disabled={busy}
          aria-invalid={failed || undefined}
          aria-describedby={messageId}
          className={cn(fieldClass, "appearance-none")}
        >
          <option value="" disabled>
            Select the closest match
          </option>
          <option value="founder">Founder or executive</option>
          <option value="support">Support or success</option>
          <option value="engineering">Engineering or QA</option>
          <option value="product">Product</option>
          <option value="other">Other</option>
        </select>
      </div>

      <div>
        <label
          htmlFor={workflowId}
          className="block text-sm font-medium text-sb-ink"
        >
          How do customer bug reports reach engineering today?{" "}
          <span className="font-normal text-sb-soft">(optional)</span>
        </label>
        <textarea
          id={workflowId}
          name="workflow"
          rows={4}
          maxLength={600}
          disabled={busy}
          aria-describedby={`${noteId} ${messageId}`}
          placeholder="For example: customers message support in Intercom, then support rewrites the report in Linear and asks for missing steps."
          className={cn(fieldClass, "resize-y py-3")}
        />
      </div>

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
        className="h-12 w-full rounded-lg bg-sb-mark px-6 text-base font-semibold text-[#11162b] hover:bg-sb-mark/85 focus-visible:border-sb-focus focus-visible:ring-sb-focus/50"
      >
        {busy ? "Sending request…" : buttonLabel}
      </Button>

      <p id={noteId} className="text-xs leading-relaxed text-sb-soft">
        We use these details to evaluate pilot fit and contact you about this
        request. For abuse prevention, the service stores a salted hash of your
        IP address—not the raw address.
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
