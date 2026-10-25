import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_ALT = "Showbug: show the bug, skip the back-and-forth";

const fontDir = join(process.cwd(), "src/lib/og");
const display = readFile(join(fontDir, "bricolage-800.ttf"));
const body = readFile(join(fontDir, "geist-500.ttf"));

/** Shared by opengraph-image and twitter-image so link previews match everywhere. */
export async function renderOgImage() {
  const [displayFont, bodyFont] = await Promise.all([display, body]);
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: "#11162b",
        color: "#eceffa",
        padding: "64px 72px",
        fontFamily: "Geist",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <svg width="56" height="56" viewBox="0 0 32 32" fill="none">
          <path
            d="M5 11V5h6M21 5h6v6M27 21v6h-6M11 27H5v-6"
            stroke="#ffa63d"
            strokeWidth="2.6"
            strokeLinecap="square"
          />
          <circle cx="16" cy="16" r="4.4" fill="#ff5a64" />
        </svg>
        <div
          style={{
            fontFamily: "Bricolage",
            fontSize: 44,
            fontWeight: 800,
            letterSpacing: -1,
          }}
        >
          Showbug
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            fontFamily: "Bricolage",
            fontSize: 124,
            fontWeight: 800,
            lineHeight: 1.02,
            letterSpacing: -4,
          }}
        >
          <div style={{ display: "flex", marginRight: 28 }}>Show the</div>
          <div
            style={{
              display: "flex",
              background: "rgba(255,166,61,0.3)",
              border: "5px solid #ffa63d",
              padding: "0 18px",
            }}
          >
            bug.
          </div>
        </div>
        <div style={{ fontSize: 38, color: "#a6aecb", maxWidth: 880 }}>
          Talk to a voice agent. Developers get the ticket and the recording.
        </div>
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 28,
          color: "#a6aecb",
        }}
      >
        <div>showbugai.com</div>
        <div style={{ color: "#ffa63d" }}>Join the waitlist</div>
      </div>
    </div>,
    {
      ...OG_SIZE,
      fonts: [
        { name: "Bricolage", data: displayFont, weight: 800, style: "normal" },
        { name: "Geist", data: bodyFont, weight: 500, style: "normal" },
      ],
    },
  );
}
