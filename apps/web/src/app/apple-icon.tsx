import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// Same mark as icon.svg, rasterised because iOS ignores SVG touch icons.
export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#11162b",
      }}
    >
      <svg width="124" height="124" viewBox="0 0 32 32" fill="none">
        <path
          d="M5 11V5h6M21 5h6v6M27 21v6h-6M11 27H5v-6"
          stroke="#ffa63d"
          strokeWidth="2.6"
          strokeLinecap="square"
        />
        <circle cx="16" cy="16" r="4.4" fill="#ff5a64" />
      </svg>
    </div>,
    size,
  );
}
