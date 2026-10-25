import Script from "next/script";
import { DemoActions } from "./demo-actions";

export const metadata = {
  title: "Acme Billing (Showbug demo host app)",
  robots: { index: false, follow: false, noarchive: true },
};

/** A stand-in "customer SaaS" that embeds the SDK exactly as a real customer would. */
export default function DemoPage() {
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-10">
      <h1 className="text-2xl font-semibold">Acme Billing</h1>
      <p className="text-muted-foreground">
        Pretend this is a customer&apos;s product with Showbug embedded. Break
        something, then click &ldquo;Report a problem&rdquo; (bottom right) and
        describe it out loud.
      </p>
      <DemoActions />
      <label className="block space-y-1 text-sm">
        <span>Card number (masked in replay)</span>
        <input
          className="w-full rounded border p-2"
          defaultValue="4242 4242 4242 4242"
        />
      </label>
      <label className="block space-y-1 text-sm">
        <span>Account notes (explicitly private)</span>
        <input
          data-private
          className="w-full rounded border p-2"
          defaultValue="secret customer note"
        />
      </label>
      <Script
        src="/sdk/loader.js"
        data-key="pk_dev_demo"
        data-api={process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}
        strategy="afterInteractive"
      />
    </main>
  );
}
