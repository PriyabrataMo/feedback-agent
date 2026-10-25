import Link from "next/link";
import { ThemeToggle } from "@/components/landing/theme-toggle";
import { WaitlistForm } from "@/components/landing/waitlist-form";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/site";

const workflow = [
  {
    actor: "Your team",
    title: "Embed the reporting button",
    body: "Add the Showbug loader to your web app. The heavier session code loads only after someone opens the widget.",
    detail: '<script src="…/loader.js" data-key="pk_…">',
  },
  {
    actor: "Your customer",
    title: "Show and describe the problem",
    body: "The customer chooses a browser tab, approves screen and microphone access, and explains what went wrong in their own words.",
    detail: "The browser permission prompt is always visible.",
  },
  {
    actor: "Showbug",
    title: "Ask for what is missing",
    body: "The assistant can ask about the expected result, frequency, or last action while the customer and the broken state are still available.",
    detail: "“What did you expect after clicking Export?”",
  },
  {
    actor: "Your team",
    title: "Review one organized report",
    body: "The prototype brings the conversation, recording, replay, browser context, and selected diagnostics into a structured draft.",
    detail: "A review-before-delivery gate is being prepared for pilots.",
  },
];

const reportParts = [
  {
    label: "Problem summary",
    body: "What the customer tried, what happened, and what they expected—when the conversation provides it.",
  },
  {
    label: "Suggested reproduction steps",
    body: "A draft derived from the customer’s words and recent clicks, clearly marked for verification.",
  },
  {
    label: "Page and browser context",
    body: "The page path, browser details, and pseudonymous user or account context when your app supplies it.",
  },
  {
    label: "Selected diagnostics",
    body: "Bounded console errors and failed-request metadata. Request headers and bodies are not collected.",
  },
  {
    label: "Conversation transcript",
    body: "The customer’s explanation and the assistant’s follow-up questions in one timeline.",
  },
  {
    label: "Recording and DOM replay",
    body: "Two different views of the session, with different privacy properties and capture limits.",
  },
];

const statusRows = [
  {
    status: "Working prototype",
    tone: "ready",
    body: "Embeddable widget, explicit screen and mic capture, live voice follow-ups, transcript, recording, DOM replay, diagnostics, and structured draft generation.",
  },
  {
    status: "Implemented; validation left",
    tone: "testing",
    body: "Linear and signed-webhook delivery adapters are covered by automated tests, but have not been verified with an external pilot customer.",
  },
  {
    status: "Before external pilots",
    tone: "building",
    body: "Review and approval, authenticated tenant access, deletion and retention controls, production storage, and remaining security hardening.",
  },
  {
    status: "Not supported yet",
    tone: "later",
    body: "Jira or GitHub delivery, mobile reporting, Safari and Firefox, complete pixel redaction, regulated-data use cases, and self-serve signup.",
  },
];

const faqs = [
  {
    q: "How much work is installation?",
    a: "The current prototype starts with one loader script and a project key. A pilot also needs an allowed-domain setup and agreement on where the button appears. We will scope that setup with each design partner rather than promise a one-click production rollout.",
  },
  {
    q: "What does the customer have to do?",
    a: "They open the widget, read the capture notice, and approve the browser’s screen-share and microphone prompts. They choose the tab to share and can stop at any time. Showbug cannot record silently or bypass those browser permissions.",
  },
  {
    q: "Does this replace our support tool or issue tracker?",
    a: "No. Showbug is intended to improve the handoff into the tools your team already uses. Support can keep the customer conversation, and engineering can keep its tracker; Showbug focuses on collecting missing bug context before the report reaches them.",
  },
  {
    q: "Which browsers and trackers are supported?",
    a: "The pilot target is desktop Chrome. Linear and signed-webhook delivery are implemented but still need real-customer validation. Jira, GitHub Issues, Safari, Firefox, and mobile are not currently supported pilot claims.",
  },
  {
    q: "What data is captured, and where does it go?",
    a: "During the prototype conversation, microphone audio and selected screen frames are processed by OpenAI’s Realtime API. Showbug also stores the transcript, recording, DOM replay, page path, and bounded diagnostic metadata. Production retention, deletion, and storage terms are not finalized, so sensitive or regulated routes are excluded from the intended pilots.",
  },
  {
    q: "Are sensitive fields redacted from everything?",
    a: "No. Form inputs are masked in the DOM replay, and elements marked data-private are excluded from replay and click capture. The screen recording contains the visible pixels in the tab the customer selected. Pixel-level redaction is not built, so payment, health, banking, credential, and secret-management screens are not appropriate for the current product.",
  },
  {
    q: "What happens when I join the waitlist?",
    a: "We store your email and use it to tell you when early access opens. If you also add the optional design-partner details, a founder may contact you to learn how reports move from customers to support and engineering. Joining does not create an account or guarantee pilot access.",
  },
  {
    q: "How much will it cost?",
    a: "Pricing has not been decided. We are measuring the cost and usefulness of completed reports before setting a plan or publishing a pilot price.",
  },
];

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: SITE_NAME,
      url: SITE_URL,
      logo: `${SITE_URL}/icon.svg`,
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      url: SITE_URL,
      name: SITE_NAME,
      description: SITE_DESCRIPTION,
      inLanguage: "en",
      publisher: { "@id": `${SITE_URL}/#organization` },
    },
  ],
};

function Mark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
      className={className}
      fill="none"
    >
      <path
        d="M5 11V5h6M21 5h6v6M27 21v6h-6M11 27H5v-6"
        stroke="var(--sb-mark)"
        strokeWidth="2.6"
        strokeLinecap="square"
      />
      <circle cx="16" cy="16" r="4.4" fill="var(--sb-rec)" />
    </svg>
  );
}

function Arrow({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      className={className}
    >
      <path
        d="M4 10h11m-4-4 4 4-4 4"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function HeroEvidence() {
  return (
    <figure className="relative mx-auto w-full max-w-[34rem] lg:ml-auto">
      <div className="absolute -inset-3 -z-10 translate-x-2 translate-y-2 rounded-[1.75rem] bg-sb-mark/20" />
      <div className="overflow-hidden rounded-2xl border border-sb-line bg-sb-surface shadow-[0_30px_80px_-45px_rgba(17,22,43,0.55)]">
        <div className="flex items-center justify-between border-b border-sb-line bg-sb-paper px-4 py-3 font-mono text-[0.68rem] uppercase tracking-[0.12em] text-sb-soft">
          <span className="flex items-center gap-2">
            <span className="sb-rec-dot size-2 rounded-full bg-sb-rec" />
            Report in progress
          </span>
          <span>Illustrative flow</span>
        </div>

        <div className="space-y-4 border-b border-sb-line p-4 sm:p-5">
          <div className="mr-8 rounded-xl rounded-bl-sm bg-sb-paper p-3.5 text-sm leading-relaxed">
            <p className="font-mono text-[0.65rem] uppercase tracking-wider text-sb-soft">
              Customer
            </p>
            <p className="mt-1">The invoice export button does nothing.</p>
          </div>
          <div className="ml-8 rounded-xl rounded-br-sm border border-sb-mark/60 bg-sb-mark/10 p-3.5 text-sm leading-relaxed">
            <p className="font-mono text-[0.65rem] uppercase tracking-wider text-sb-soft">
              Showbug
            </p>
            <p className="mt-1">
              What did you expect to download? Does it fail for every invoice?
            </p>
          </div>
          <div className="mr-8 rounded-xl rounded-bl-sm bg-sb-paper p-3.5 text-sm leading-relaxed">
            <p className="font-mono text-[0.65rem] uppercase tracking-wider text-sb-soft">
              Customer
            </p>
            <p className="mt-1">
              A CSV. It only fails for invoices with no line items.
            </p>
          </div>
        </div>

        <div className="p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-sb-soft">
              Draft report
            </p>
            <span className="rounded-full border border-sb-line px-2 py-1 font-mono text-[0.62rem] text-sb-soft">
              Needs review
            </span>
          </div>
          <p className="mt-3 font-display text-xl font-semibold leading-snug">
            Invoice export fails when line items are empty
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2 font-mono text-[0.68rem] text-sb-soft sm:grid-cols-4">
            {[
              ["Page", "/invoices"],
              ["Evidence", "1 error"],
              ["Repro", "3 steps"],
              ["Media", "1:12"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg bg-sb-paper px-2.5 py-2">
                <span className="block uppercase tracking-wider">{label}</span>
                <span className="mt-1 block font-sans text-xs font-medium text-sb-ink">
                  {value}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <figcaption className="mt-4 text-xs leading-relaxed text-sb-soft">
        Illustrative example, not a customer report. It shows the intended
        clarification-to-draft workflow.
      </figcaption>
    </figure>
  );
}

function ExampleReport() {
  return (
    <figure id="example-report" className="scroll-mt-28">
      <div className="overflow-hidden rounded-2xl border border-sb-line bg-sb-surface shadow-[0_30px_80px_-45px_rgba(17,22,43,0.55)]">
        <div className="flex items-center justify-between border-b border-sb-line bg-sb-paper px-4 py-3 font-mono text-xs text-sb-soft">
          <span className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-sb-rec" />
            report draft
          </span>
          <span>needs review</span>
        </div>
        <div className="space-y-6 p-5 sm:p-7">
          <div>
            <p className="font-display text-2xl font-semibold leading-snug">
              Invoice export fails when line items are empty
            </p>
            <p className="mt-2 font-mono text-xs text-sb-soft">
              app.example.com/billing/invoices · Chrome 130
            </p>
          </div>
          <div>
            <p className="font-mono text-xs uppercase tracking-wider text-sb-soft">
              Summary
            </p>
            <p className="mt-2 text-sm leading-relaxed">
              The customer expected a CSV after selecting Export. Nothing
              downloaded when the invoice had no line items; populated invoices
              exported normally.
            </p>
          </div>
          <div>
            <p className="font-mono text-xs uppercase tracking-wider text-sb-soft">
              Suggested steps to reproduce
            </p>
            <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed">
              <li>Open Billing → Invoices.</li>
              <li>Create an invoice without adding a line item.</li>
              <li>Select Export and observe that no CSV downloads.</li>
            </ol>
          </div>
          <div>
            <p className="font-mono text-xs uppercase tracking-wider text-sb-soft">
              Selected evidence
            </p>
            <div className="mt-2 overflow-x-auto rounded-lg bg-sb-paper p-3 font-mono text-xs leading-relaxed text-sb-rec">
              TypeError: Cannot read properties of undefined
              <br />
              <span className="text-sb-soft">
                at exportInvoice (/billing/invoices)
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full border border-sb-line px-3 py-1.5">
              Transcript
            </span>
            <span className="rounded-full border border-sb-line px-3 py-1.5">
              Screen + audio · 1:12
            </span>
            <span className="rounded-full border border-sb-line px-3 py-1.5">
              DOM replay
            </span>
          </div>
        </div>
      </div>
      <figcaption className="mt-4 text-xs leading-relaxed text-sb-soft">
        Illustrative report written by us. Field availability depends on what
        the customer says and what the browser captures.
      </figcaption>
    </figure>
  );
}

export default function Home() {
  return (
    <div className="sb-page min-h-screen overflow-x-clip bg-sb-paper text-sb-ink">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
        }}
      />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-sb-ink focus:px-4 focus:py-2 focus:text-sb-paper"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-40 border-b border-sb-line/80 bg-sb-paper/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-8">
          <Link
            href="/"
            aria-label="Showbug home"
            className="flex items-center gap-2 rounded-md font-display text-xl font-bold tracking-tight outline-none focus-visible:ring-3 focus-visible:ring-sb-focus/60"
          >
            <Mark className="size-7" />
            Showbug
          </Link>
          <nav
            aria-label="Main navigation"
            className="hidden items-center gap-7 md:flex"
          >
            <a className="sb-nav-link" href="#how-it-works">
              How it works
            </a>
            <a className="sb-nav-link" href="#report">
              The report
            </a>
            <a className="sb-nav-link" href="#fit">
              Fit
            </a>
            <a className="sb-nav-link" href="#questions">
              Questions
            </a>
          </nav>
          <div className="flex items-center gap-2 sm:gap-3">
            <a
              href="#waitlist"
              className="hidden rounded-lg bg-sb-ink px-4 py-2.5 text-sm font-semibold text-sb-paper outline-none transition-transform hover:-translate-y-0.5 focus-visible:ring-3 focus-visible:ring-sb-focus/60 min-[420px]:inline-flex"
            >
              Join the waitlist
            </a>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main id="main">
        <section className="relative">
          <div className="mx-auto grid max-w-7xl gap-16 px-5 pb-24 pt-14 sm:px-8 sm:pt-20 lg:grid-cols-[1.04fr_0.96fr] lg:items-center lg:gap-20 lg:pb-32 lg:pt-24">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-sb-line bg-sb-surface px-3 py-1.5 font-mono text-[0.68rem] uppercase tracking-[0.12em] text-sb-soft">
                <span className="size-2 rounded-full bg-sb-mark" />
                Pre-launch · waitlist open
              </p>
              <h1 className="mt-7 max-w-3xl font-display text-[clamp(2.75rem,5.25vw,4.75rem)] font-bold leading-[1.04] tracking-[-0.035em]">
                Get missing bug context before your team has to{" "}
                <span className="sb-inspect">ask.</span>
              </h1>
              <p className="mt-7 max-w-2xl text-lg leading-relaxed text-sb-soft sm:text-xl">
                Showbug is an embeddable bug-reporting assistant for B2B web
                apps. It asks customers relevant questions while the problem is
                still in front of them, then organizes the conversation, browser
                context, and available evidence into a structured draft.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                <a
                  href="#waitlist"
                  className="group inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-sb-ink px-6 py-3 font-semibold text-sb-paper outline-none transition-transform hover:-translate-y-0.5 focus-visible:ring-3 focus-visible:ring-sb-focus/60"
                >
                  Join the waitlist
                  <Arrow className="size-5 transition-transform group-hover:translate-x-0.5" />
                </a>
                <a
                  href="#example-report"
                  className="inline-flex min-h-12 items-center justify-center rounded-lg border border-sb-ink/30 bg-sb-surface px-6 py-3 font-semibold outline-none hover:bg-sb-paper focus-visible:ring-3 focus-visible:ring-sb-focus/60"
                >
                  See an example report
                </a>
              </div>
              <p className="mt-4 max-w-xl text-sm leading-relaxed text-sb-soft">
                Email is all you need. Design-partner details are optional, and
                no self-serve account is created.
              </p>
            </div>
            <HeroEvidence />
          </div>
        </section>

        <section
          aria-labelledby="prototype-status"
          className="border-y border-sb-line bg-sb-mark/10"
        >
          <div className="mx-auto grid max-w-7xl gap-6 px-5 py-7 sm:px-8 lg:grid-cols-[0.65fr_1.35fr] lg:items-center">
            <div>
              <p className="font-mono text-[0.68rem] uppercase tracking-[0.14em] text-sb-soft">
                Product evidence
              </p>
              <h2
                id="prototype-status"
                className="mt-1 font-display text-xl font-semibold"
              >
                Working in the prototype today
              </h2>
            </div>
            <ul className="grid grid-cols-2 gap-x-5 gap-y-3 text-sm text-sb-soft sm:grid-cols-4">
              {[
                "Embeddable widget",
                "Live voice follow-ups",
                "Permissioned capture",
                "Replay + report draft",
              ].map((item) => (
                <li key={item} className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="size-1.5 shrink-0 rounded-full bg-sb-mark"
                  />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:py-28">
          <div className="grid gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:gap-20">
            <div>
              <p className="sb-kicker">The problem</p>
              <h2 className="mt-3 font-display text-4xl font-bold tracking-tight sm:text-5xl">
                A vague report creates work for everyone after it
              </h2>
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-sb-soft">
                “Export is broken” may be true, but it does not tell support
                what to ask or engineering what to inspect. By the time someone
                follows up, the customer may have left the page or forgotten the
                exact sequence.
              </p>
            </div>
            <ol className="grid gap-4 sm:grid-cols-3">
              {[
                [
                  "01",
                  "Customer",
                  "Reports the visible symptom, often without expected behavior or exact steps.",
                ],
                [
                  "02",
                  "Support",
                  "Asks for the page, browser, recording, frequency, and what happened just before.",
                ],
                [
                  "03",
                  "Engineering",
                  "Reconstructs the story across chat threads before debugging can begin.",
                ],
              ].map(([number, title, body]) => (
                <li
                  key={number}
                  className="rounded-xl border border-sb-line bg-sb-surface p-5"
                >
                  <span className="font-mono text-xs text-sb-rec">
                    {number}
                  </span>
                  <h3 className="mt-8 font-display text-xl font-semibold">
                    {title}
                  </h3>
                  <p className="mt-3 text-sm leading-relaxed text-sb-soft">
                    {body}
                  </p>
                </li>
              ))}
            </ol>
          </div>
          <div className="mt-12 rounded-2xl border border-sb-mark/60 bg-sb-mark/10 px-6 py-6 sm:flex sm:items-center sm:justify-between sm:gap-10 lg:px-8">
            <p className="font-display text-2xl font-semibold sm:max-w-md">
              The best time to clarify a bug report is before the customer
              submits it.
            </p>
            <p className="mt-3 max-w-xl leading-relaxed text-sb-soft sm:mt-0">
              That is the product hypothesis we are testing: whether relevant
              questions in the reporting moment reduce the clarification work
              handed to support and engineering.
            </p>
          </div>
        </section>

        <section
          id="how-it-works"
          aria-labelledby="workflow-heading"
          className="scroll-mt-24 border-y border-sb-line bg-sb-surface"
        >
          <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:py-28">
            <div className="max-w-3xl">
              <p className="sb-kicker">Customer → assistant → team</p>
              <h2
                id="workflow-heading"
                className="mt-3 font-display text-4xl font-bold tracking-tight sm:text-5xl"
              >
                One reporting flow, with clear roles
              </h2>
              <p className="mt-5 text-lg leading-relaxed text-sb-soft">
                Showbug sits between the first “something broke” and the handoff
                to your existing support or issue-tracking workflow. It is not a
                replacement for either.
              </p>
            </div>
            <ol className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-sb-line bg-sb-line md:grid-cols-2 xl:grid-cols-4">
              {workflow.map((step, index) => (
                <li
                  key={step.title}
                  className="flex min-h-80 flex-col bg-sb-paper p-6"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="rounded-full bg-sb-ink px-2.5 py-1 font-mono text-[0.65rem] uppercase tracking-wider text-sb-paper">
                      {step.actor}
                    </span>
                    <span className="font-mono text-sm text-sb-soft">
                      0{index + 1}
                    </span>
                  </div>
                  <h3 className="mt-8 font-display text-2xl font-semibold leading-tight">
                    {step.title}
                  </h3>
                  <p className="mt-4 leading-relaxed text-sb-soft">
                    {step.body}
                  </p>
                  <p className="mt-auto border-t border-sb-line pt-5 font-mono text-xs leading-relaxed text-sb-soft">
                    {step.detail}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section
          id="report"
          aria-labelledby="report-heading"
          className="scroll-mt-24 mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:py-28"
        >
          <div className="grid gap-14 lg:grid-cols-[0.95fr_1.05fr] lg:items-start lg:gap-20">
            <ExampleReport />
            <div>
              <p className="sb-kicker">The output</p>
              <h2
                id="report-heading"
                className="mt-3 font-display text-4xl font-bold tracking-tight sm:text-5xl"
              >
                Give engineering a report, not a scavenger hunt
              </h2>
              <p className="mt-5 text-lg leading-relaxed text-sb-soft">
                The draft keeps the customer’s account separate from machine-
                collected evidence. It helps a reviewer see what is known, what
                was inferred, and what may still need verification.
              </p>
              <dl className="mt-10 grid gap-x-8 gap-y-7 sm:grid-cols-2">
                {reportParts.map((part) => (
                  <div
                    key={part.label}
                    className="border-t border-sb-line pt-4"
                  >
                    <dt className="font-display text-lg font-semibold">
                      {part.label}
                    </dt>
                    <dd className="mt-2 text-sm leading-relaxed text-sb-soft">
                      {part.body}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </section>

        <section className="border-y border-sb-line bg-sb-surface">
          <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:py-24">
            <div className="max-w-3xl">
              <p className="sb-kicker">Capture, explained plainly</p>
              <h2 className="mt-3 font-display text-4xl font-bold tracking-tight sm:text-5xl">
                A recording and a replay are not the same thing
              </h2>
              <p className="mt-5 text-lg leading-relaxed text-sb-soft">
                The distinction matters when you evaluate diagnostic value,
                permissions, and sensitive-data risk.
              </p>
            </div>
            <div className="mt-12 grid gap-5 lg:grid-cols-2">
              <article className="rounded-2xl border border-sb-line bg-sb-paper p-6 sm:p-8">
                <div className="flex items-center gap-3">
                  <span className="flex size-10 items-center justify-center rounded-full bg-sb-rec font-mono text-xs text-sb-surface">
                    REC
                  </span>
                  <h3 className="font-display text-2xl font-semibold">
                    Screen + audio recording
                  </h3>
                </div>
                <p className="mt-5 leading-relaxed text-sb-soft">
                  A video of the pixels in the browser tab the customer chose,
                  mixed with microphone and assistant audio. It helps reviewers
                  see timing and visual state.
                </p>
                <ul className="mt-6 space-y-3 text-sm leading-relaxed text-sb-soft">
                  <li className="border-l-2 border-sb-mark pl-3">
                    Requires the browser’s screen and mic permission prompts.
                  </li>
                  <li className="border-l-2 border-sb-mark pl-3">
                    Contains visible pixels; DOM masking does not redact the
                    video.
                  </li>
                  <li className="border-l-2 border-sb-mark pl-3">
                    Current prototype rejects window or whole-monitor capture.
                  </li>
                </ul>
              </article>
              <article className="rounded-2xl border border-sb-line bg-sb-paper p-6 sm:p-8">
                <div className="flex items-center gap-3">
                  <span className="flex size-10 items-center justify-center rounded-full border border-sb-mark font-mono text-xs text-sb-ink">
                    DOM
                  </span>
                  <h3 className="font-display text-2xl font-semibold">
                    DOM-based replay
                  </h3>
                </div>
                <p className="mt-5 leading-relaxed text-sb-soft">
                  A reconstruction from captured page events—not a second video.
                  It can make clicks and page changes easier to inspect
                  alongside the transcript.
                </p>
                <ul className="mt-6 space-y-3 text-sm leading-relaxed text-sb-soft">
                  <li className="border-l-2 border-sb-mark pl-3">
                    Masks form inputs and excludes elements marked data-private.
                  </li>
                  <li className="border-l-2 border-sb-mark pl-3">
                    May not faithfully reproduce canvas, video, or cross-origin
                    content.
                  </li>
                  <li className="border-l-2 border-sb-mark pl-3">
                    Masking applies to the replay, not the raw screen recording.
                  </li>
                </ul>
              </article>
            </div>
          </div>
        </section>

        <section
          id="fit"
          aria-labelledby="fit-heading"
          className="scroll-mt-24 mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:py-28"
        >
          <div className="grid gap-12 lg:grid-cols-[0.75fr_1.25fr] lg:gap-20">
            <div>
              <p className="sb-kicker">Best pilot fit</p>
              <h2
                id="fit-heading"
                className="mt-3 font-display text-4xl font-bold tracking-tight sm:text-5xl"
              >
                Built for the handoff between customers and engineers
              </h2>
              <p className="mt-5 text-lg leading-relaxed text-sb-soft">
                The customer uses the widget. Support and engineering review the
                result. A founder, support lead, or engineering lead typically
                owns the decision to pilot it.
              </p>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="rounded-2xl border border-sb-ink/20 bg-sb-surface p-6">
                <p className="font-mono text-xs uppercase tracking-[0.14em] text-sb-soft">
                  A good fit now
                </p>
                <ul className="mt-6 space-y-4">
                  {[
                    "B2B SaaS with an authenticated browser app",
                    "Roughly 5–50 engineers",
                    "Support relays vague reports to engineering",
                    "Low-sensitivity routes and pilot accounts",
                    "A team willing to review report quality with us",
                  ].map((item) => (
                    <li key={item} className="flex gap-3 leading-relaxed">
                      <span
                        aria-hidden="true"
                        className="mt-2 size-2 shrink-0 rounded-full bg-sb-mark"
                      />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-2xl border border-sb-line bg-sb-paper p-6">
                <p className="font-mono text-xs uppercase tracking-[0.14em] text-sb-soft">
                  Not a fit yet
                </p>
                <ul className="mt-6 space-y-4">
                  {[
                    "Payment, health, banking, or credential screens",
                    "Mobile-first products or non-Chrome requirements",
                    "Silent or background recording",
                    "Guaranteed reproduction or root-cause diagnosis",
                    "A replacement for support or issue tracking",
                  ].map((item) => (
                    <li
                      key={item}
                      className="flex gap-3 leading-relaxed text-sb-soft"
                    >
                      <span
                        aria-hidden="true"
                        className="mt-2 size-2 shrink-0 rounded-full border border-sb-soft"
                      />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        <section className="border-y border-sb-line bg-sb-surface">
          <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:py-24">
            <div className="grid gap-12 lg:grid-cols-[0.7fr_1.3fr] lg:gap-20">
              <div>
                <p className="sb-kicker">Availability</p>
                <h2 className="mt-3 font-display text-4xl font-bold tracking-tight">
                  What works, and what still needs work
                </h2>
                <p className="mt-5 leading-relaxed text-sb-soft">
                  This is a pre-launch product, not a finished self-serve SaaS.
                  Pilot access depends on the remaining privacy, review, and
                  production-readiness work.
                </p>
              </div>
              <div className="divide-y divide-sb-line border-y border-sb-line">
                {statusRows.map((row) => (
                  <div
                    key={row.status}
                    className="grid gap-3 py-5 sm:grid-cols-[13rem_1fr] sm:gap-6"
                  >
                    <p className={`sb-status sb-status-${row.tone}`}>
                      {row.status}
                    </p>
                    <p className="text-sm leading-relaxed text-sb-soft">
                      {row.body}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section
          id="questions"
          aria-labelledby="questions-heading"
          className="scroll-mt-24 mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:py-28"
        >
          <div className="grid gap-12 lg:grid-cols-[0.7fr_1.3fr] lg:gap-20">
            <div>
              <p className="sb-kicker">Buyer questions</p>
              <h2
                id="questions-heading"
                className="mt-3 font-display text-4xl font-bold tracking-tight sm:text-5xl"
              >
                Details before you join
              </h2>
            </div>
            <div className="divide-y divide-sb-line border-y border-sb-line">
              {faqs.map((faq) => (
                <details key={faq.q} className="group py-1">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-5 rounded-md py-5 font-display text-lg font-semibold outline-none focus-visible:ring-3 focus-visible:ring-sb-focus/60 [&::-webkit-details-marker]:hidden">
                    {faq.q}
                    <span
                      aria-hidden="true"
                      className="font-mono text-2xl font-normal text-sb-soft transition-transform group-open:rotate-45"
                    >
                      +
                    </span>
                  </summary>
                  <p className="max-w-3xl pb-6 pr-10 leading-relaxed text-sb-soft">
                    {faq.a}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section
          id="waitlist"
          aria-labelledby="waitlist-heading"
          className="scroll-mt-24 border-t border-sb-line bg-sb-surface"
        >
          <div className="mx-auto grid max-w-7xl gap-12 px-5 py-20 sm:px-8 lg:grid-cols-[0.85fr_1.15fr] lg:gap-20 lg:py-24">
            <div>
              <p className="sb-kicker">Early access</p>
              <h2
                id="waitlist-heading"
                className="mt-3 max-w-xl font-display text-4xl font-bold leading-tight tracking-tight sm:text-5xl"
              >
                Join with just your email
              </h2>
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-sb-soft">
                Get an update when early access opens. If you want to explore a
                design-partner pilot, you can optionally tell us about your team
                and current workflow.
              </p>
              <ul className="mt-8 space-y-3 text-sm text-sb-soft">
                <li className="flex gap-3">
                  <span className="font-mono text-sb-rec">01</span> Email is the
                  only required field.
                </li>
                <li className="flex gap-3">
                  <span className="font-mono text-sb-rec">02</span> Pilot
                  qualification stays collapsed unless you want it.
                </li>
                <li className="flex gap-3">
                  <span className="font-mono text-sb-rec">03</span> Joining does
                  not create an account or promise access.
                </li>
              </ul>
            </div>
            <div className="rounded-2xl border border-sb-line bg-sb-paper p-5 text-sb-ink shadow-[0_24px_70px_-48px_rgba(17,22,43,0.55)] sm:p-7">
              <WaitlistForm />
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-sb-line bg-sb-paper text-sb-soft">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-5 py-8 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <p className="flex items-center gap-2 text-sb-ink">
            <Mark className="size-5" />
            Showbug · showbugai.com
          </p>
          <nav
            aria-label="Footer navigation"
            className="flex flex-wrap gap-x-5 gap-y-2"
          >
            <a className="hover:text-sb-ink" href="#how-it-works">
              How it works
            </a>
            <a className="hover:text-sb-ink" href="#fit">
              Pilot fit
            </a>
            <a className="hover:text-sb-ink" href="#questions">
              Questions
            </a>
            <a className="hover:text-sb-ink" href="#waitlist">
              Join the waitlist
            </a>
          </nav>
          <p>Pre-launch · details may change</p>
        </div>
      </footer>
    </div>
  );
}
