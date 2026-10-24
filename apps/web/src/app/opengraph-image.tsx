import { ImageResponse } from "next/og";

export const alt = "Showbug: show the bug, skip the back-and-forth";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
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
        padding: 72,
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 14,
            background: "#ff5a64",
          }}
        />
        <div style={{ fontSize: 34, fontWeight: 700 }}>Showbug</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div
          style={{
            display: "flex",
            fontSize: 112,
            fontWeight: 800,
            lineHeight: 1,
            letterSpacing: -3,
          }}
        >
          <span>Show the&nbsp;</span>
          <span
            style={{
              background: "rgba(255,166,61,0.32)",
              border: "4px solid #ffa63d",
              padding: "0 14px",
            }}
          >
            bug.
          </span>
        </div>
        <div style={{ fontSize: 36, color: "#a6aecb" }}>
          Talk to a voice agent. Developers get the ticket and the recording.
        </div>
      </div>
      <div style={{ fontSize: 28, color: "#a6aecb" }}>showbugai.com</div>
    </div>,
    size,
  );
}
