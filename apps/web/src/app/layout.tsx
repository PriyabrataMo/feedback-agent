import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const display = Bricolage_Grotesque({
  variable: "--font-display",
  subsets: ["latin"],
  axes: ["opsz", "wdth"],
});

const siteTitle = "Showbug: show the bug, skip the back-and-forth";
const siteDescription =
  "Showbug is an embeddable button. Your user talks to a voice AI agent while their screen and mic are captured, and your developers get a ticket with the recording attached. Join the waitlist.";

export const metadata: Metadata = {
  metadataBase: new URL("https://showbugai.com"),
  title: { default: siteTitle, template: "%s · Showbug" },
  description: siteDescription,
  applicationName: "Showbug",
  openGraph: {
    type: "website",
    siteName: "Showbug",
    url: "/",
    title: siteTitle,
    description: siteDescription,
  },
  twitter: {
    card: "summary_large_image",
    title: siteTitle,
    description: siteDescription,
  },
};

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f4f9" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0f1e" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: the script below sets data-theme before React hydrates.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${display.variable} h-full antialiased`}
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("showbug-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
