import Link from "next/link";
import { ThemeToggle } from "@/components/landing/theme-toggle";
import { WaitlistForm } from "@/components/landing/waitlist-form";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/site";

const steps = [
  {
    title: "Add one script tag",
    body: "Drop the Showbug snippet into your app. It adds a small report button and loads the rest only when someone clicks it.",
    detail: '<script src="…/loader.js" data-key="pk_…">',
  },
  {
    title: "The user shows and tells",
    body: "They click the button and the browser asks for screen and mic access. A voice agent asks what went wrong, then follows up on whatever is still unclear while they point at it on screen.",
    detail: "“Does it happen on every invoice?”",
  },
  {
    title: "Your developers get a ticket",
    body: "Capture stops when the user is done. The session becomes a ticket for your tracker, with the recording and the context attached.",
    detail: "Linear · Jira · webhook (planned)",
  },
];

const ticketParts = [
  {
    label: "Summary",
    body: "What broke and where, in a sentence or two.",
  },
  {
    label: "Repro steps",
    body: "Built from the user's clicks, page changes and what they said.",
  },
  {
    label: "Expected vs. actual",
    body: "As the reporter described it, with the follow-up questions already asked.",
  },
  {
    label: "Page and user",
    body: "URL, browser, and who they were if your app identifies them.",
  },
  {
    label: "Console and network",
    body: "Recent console errors and failed requests, length-limited.",
  },
  {
    label: "Recording",
    body: "Screen and voice with a transcript, plus a replay of the page in the dashboard.",
  },
];

const audiences = [
  {
    who: "SaaS teams with a browser app and signed-in users",
    why: "The first pilots target teams of roughly 5 to 50 engineers who lose hours asking customers what they were doing when it broke.",
  },
  {
    who: "Support and QA who relay bug reports",
    why: "Stop forwarding “it's broken” with a screenshot. The follow-up questions get asked while the reporter is still on the page.",
  },
  {
    who: "Engineers who reproduce bugs from a one-line message",
    why: "Open the ticket, watch what happened, read the console error, and start on the fix.",
  },
];

const faqs = [
  {
    q: "Does it record without asking?",
    a: "No. Nothing is captured until the user clicks the button and then approves the browser's own screen-share and microphone prompts. They choose what to share, and they can stop sharing at any time.",
  },
  {
    q: "What about passwords, card numbers and other sensitive data?",
    a: "Form inputs are masked in the page replay, and anything you mark with data-private is left out of replay and click capture. The screen recording is different: it contains whatever pixels are on screen, and masking the page does not hide those. Pixel-level redaction is not built yet, so we advise keeping Showbug off pages that show payment, health, banking or credential data.",
  },
  {
    q: "Who else sees the audio and the screen?",
    a: "The voice agent runs on a third-party realtime AI provider, so microphone audio and screen frames are sent to it during the conversation. Today that is OpenAI's Realtime API.",
  },
  {
    q: "Which browsers and trackers will it support?",
    a: "Desktop Chrome first. For tickets, we are building delivery to a webhook and to Linear and Jira. Which ones ship first depends on what the waitlist teams use.",
  },
  {
    q: "How much will it cost?",
    a: "Not decided yet. Every session runs a voice model, so pricing will be based on usage, and we are still measuring what a session costs.",
  },
  {
    q: "What happens when I join the waitlist?",
    a: "We store your email and use it to tell you when early access opens.",
  },
];

// Structured data for search engines. The FAQ entries are the same text rendered on the page.
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
    {
      "@type": "FAQPage",
      "@id": `${SITE_URL}/#faq`,
      mainEntity: faqs.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
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

function ExampleTicket() {
  return (
    <figure className="w-full">
      <div className="overflow-hidden rounded-xl border border-sb-ink/20 bg-sb-surface shadow-[6px_6px_0_0_var(--sb-ink)]">
        <div className="flex items-center justify-between border-b border-sb-line bg-sb-paper px-4 py-2.5 font-mono text-xs text-sb-soft">
          <span className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="sb-rec-dot size-2 rounded-full bg-sb-rec"
            />
            recording.webm · 1:12
          </span>
          <span>example ticket</span>
        </div>
        <div className="space-y-5 p-5 text-sm text-sb-ink">
          <div>
            <p className="font-display text-xl font-semibold leading-snug">
              Invoice export fails on invoices with no line items
            </p>
            <p className="mt-1 font-mono text-xs text-sb-soft">
              app.example.com/billing/invoices
            </p>
          </div>
          <dl className="space-y-4">
            <div>
              <dt className="font-mono text-xs uppercase tracking-wider text-sb-soft">
                Repro steps
              </dt>
              <dd className="mt-1">
                <ol className="list-decimal space-y-0.5 pl-5">
                  <li>Open Billing → Invoices.</li>
                  <li>Create a new invoice and leave it empty.</li>
                  <li>
                    Click <em className="not-italic font-medium">Export</em>.
                    Nothing downloads.
                  </li>
                </ol>
              </dd>
            </div>
            <div>
              <dt className="font-mono text-xs uppercase tracking-wider text-sb-soft">
                Console
              </dt>
              <dd className="mt-1 rounded-md bg-sb-paper px-3 py-2 font-mono text-xs leading-relaxed text-sb-rec">
                TypeError: Cannot read properties of undefined (reading
                &apos;lineItems&apos;)
              </dd>
            </div>
            <div>
              <dt className="font-mono text-xs uppercase tracking-wider text-sb-soft">
                Said by the reporter
              </dt>
              <dd className="mt-1 space-y-1">
                <p>
                  <span className="font-medium">Agent:</span> Does it happen on
                  every invoice?
                </p>
                <p>
                  <span className="font-medium">User:</span> Only the ones I
                  just created.
                </p>
              </dd>
            </div>
          </dl>
        </div>
      </div>
      <figcaption className="mt-4 text-xs text-sb-soft">
        Illustrative example written by us. Not a real customer report.
      </figcaption>
    </figure>
  );
}

export default function Home() {
  return (
    <div className="sb-page min-h-screen bg-sb-paper text-sb-ink">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          // "<" is escaped so FAQ text can never close the script tag.
          __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
        }}
      />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-sb-ink focus:px-4 focus:py-2 focus:text-sb-paper"
      >
        Skip to content
      </a>

      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
        <Link
          href="/"
          className="flex items-center gap-2 rounded-md font-display text-xl font-bold tracking-tight outline-none focus-visible:ring-3 focus-visible:ring-sb-focus/60"
        >
          <Mark className="size-7" />
          Showbug
        </Link>
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Hidden on very narrow phones: the form is right below the hero. */}
          <a
            href="#waitlist"
            className="hidden rounded-lg border border-sb-ink/30 px-4 py-2 text-sm font-medium outline-none hover:bg-sb-surface focus-visible:ring-3 focus-visible:ring-sb-focus/60 min-[400px]:inline-block"
          >
            Join the waitlist
          </a>
          <ThemeToggle />
        </div>
      </header>

      <main id="main">
        <section className="mx-auto grid max-w-6xl gap-14 px-5 pb-20 pt-10 sm:px-8 lg:grid-cols-[1.15fr_0.85fr] lg:items-center lg:pb-28 lg:pt-16">
          <div>
            <p className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-sb-soft">
              <span
                aria-hidden="true"
                className="sb-rec-dot size-2 rounded-full bg-sb-rec"
              />
              Pre-launch · waitlist open
            </p>
            <h1 className="mt-5 font-display text-[clamp(3rem,8vw,6rem)] font-extrabold leading-[0.95] tracking-tight [font-variation-settings:'wdth'_92]">
              Show the <span className="sb-inspect">bug</span>.
              <br />
              Skip the back&#8209;and&#8209;forth.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-sb-soft">
              Showbug is a button you embed in your app. Your user clicks it and
              talks to a voice AI agent while their screen and mic are captured.
              Your developers get a ticket with the recording attached.
            </p>
            <div id="waitlist" className="mt-9 max-w-xl scroll-mt-8">
              <WaitlistForm />
            </div>
            <p className="mt-8 max-w-xl border-l-2 border-sb-mark pl-4 text-sm leading-relaxed text-sb-soft">
              <span className="font-medium text-sb-ink">Where it stands.</span>{" "}
              The widget, capture and a session dashboard with replay work
              today. AI-written tickets and delivery to Linear, Jira or a
              webhook are still being built.
            </p>
          </div>
          <ExampleTicket />
        </section>

        <section
          aria-labelledby="how"
          className="border-y border-sb-line bg-sb-surface"
        >
          <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
            <h2
              id="how"
              className="max-w-2xl font-display text-3xl font-bold tracking-tight sm:text-4xl"
            >
              From “something is broken” to a ticket, in three steps
            </h2>
            <ol className="mt-12 grid gap-10 md:grid-cols-3 md:gap-8">
              {steps.map((s, i) => (
                <li key={s.title} className="border-t-2 border-sb-ink pt-5">
                  <span className="font-mono text-sm text-sb-soft">
                    Step {i + 1}
                  </span>
                  <h3 className="mt-2 font-display text-xl font-semibold">
                    {s.title}
                  </h3>
                  <p className="mt-3 leading-relaxed text-sb-soft">{s.body}</p>
                  <p className="mt-4 rounded-md bg-sb-paper px-3 py-2 font-mono text-xs text-sb-ink">
                    {s.detail}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section
          aria-labelledby="get"
          className="mx-auto grid max-w-6xl gap-12 px-5 py-20 sm:px-8 lg:grid-cols-[0.8fr_1.2fr]"
        >
          <div>
            <h2
              id="get"
              className="font-display text-3xl font-bold tracking-tight sm:text-4xl"
            >
              A ticket a developer can start on
            </h2>
            <p className="mt-4 max-w-md leading-relaxed text-sb-soft">
              The goal: no second conversation with the reporter. This is what
              each ticket is built to contain.
            </p>
          </div>
          <dl className="grid gap-x-10 gap-y-7 sm:grid-cols-2">
            {ticketParts.map((t) => (
              <div key={t.label} className="border-t border-sb-line pt-4">
                <dt className="font-mono text-sm font-medium">{t.label}</dt>
                <dd className="mt-1.5 leading-relaxed text-sb-soft">
                  {t.body}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section
          aria-labelledby="who"
          className="border-y border-sb-line bg-sb-surface"
        >
          <div className="mx-auto grid max-w-6xl gap-12 px-5 py-20 sm:px-8 lg:grid-cols-[0.8fr_1.2fr]">
            <div>
              <h2
                id="who"
                className="font-display text-3xl font-bold tracking-tight sm:text-4xl"
              >
                Who it&apos;s for
              </h2>
              <p className="mt-4 max-w-md leading-relaxed text-sb-soft">
                Not for yet: products that handle payments, health, banking or
                credentials on screen. We would rather say so now.
              </p>
            </div>
            <ul className="divide-y divide-sb-line border-y border-sb-line">
              {audiences.map((a) => (
                <li key={a.who} className="py-5">
                  <h3 className="font-display text-lg font-semibold">
                    {a.who}
                  </h3>
                  <p className="mt-1.5 leading-relaxed text-sb-soft">{a.why}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section
          aria-labelledby="faq"
          className="mx-auto grid max-w-6xl gap-12 px-5 py-20 sm:px-8 lg:grid-cols-[0.8fr_1.2fr]"
        >
          <h2
            id="faq"
            className="font-display text-3xl font-bold tracking-tight sm:text-4xl"
          >
            Questions, answered plainly
          </h2>
          <div className="divide-y divide-sb-line border-y border-sb-line">
            {faqs.map((f) => (
              <details key={f.q} className="group py-1">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-md py-4 font-display text-lg font-semibold outline-none focus-visible:ring-3 focus-visible:ring-sb-focus/60 [&::-webkit-details-marker]:hidden">
                  {f.q}
                  <span
                    aria-hidden="true"
                    className="font-mono text-xl text-sb-soft transition-transform group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>
                <p className="pb-5 pr-8 leading-relaxed text-sb-soft">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section
          aria-labelledby="join"
          className="border-t border-sb-line bg-sb-surface"
        >
          <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 lg:py-24">
            <h2
              id="join"
              className="max-w-2xl font-display text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl"
            >
              Get early access when it opens
            </h2>
            <p className="mt-4 max-w-xl text-lg leading-relaxed text-sb-soft">
              Join the waitlist and we will email you once, when Showbug is
              ready for the first teams.
            </p>
            <div className="mt-8 max-w-xl">
              <WaitlistForm />
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-sb-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-5 py-8 text-sm text-sb-soft sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <p className="flex items-center gap-2">
            <Mark className="size-5" />
            Showbug · showbugai.com
          </p>
          <p>Pre-launch. Details may change.</p>
        </div>
      </footer>
    </div>
  );
}
