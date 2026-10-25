/**
 * Waitlist endpoint. The browser posts here; we validate, enrich with request
 * details (device, coarse location, salted IP hash) and store the signup in MongoDB.
 *
 * Request  (JSON): { email, source?, website?, telemetry? }   (`website` is a honeypot)
 * Response (JSON): 200 { ok: true }                      (new and duplicate emails alike)
 *                  422 { ok: false, error: "invalid_email" | "invalid_request" }
 *                  429 { ok: false, error: "rate_limited" }
 *                  502 { ok: false, error: "unavailable" }
 */
import {
  clientIp,
  hashIp,
  isRateLimited,
  saveSignup,
  type ClientTelemetry,
  type RequestInfo,
} from "@/lib/waitlist";

const MAX_EMAIL = 254;
const MAX_SOURCE = 64;
const MAX_HONEYPOT = 256;
const MAX_BODY_BYTES = 4096;

// Deliberately basic: one "@", no whitespace, a dot in the domain.
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

function reply(
  status: number,
  body: { ok: boolean; error?: string },
  headers?: Record<string, string>,
) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

/** Strips control characters and truncates; returns null for empty or non-string input. */
function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const clean = value
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, max);
  return clean.length > 0 ? clean : null;
}

function int(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
    ? Math.round(value)
    : null;
}

function size(value: unknown): { w: number; h: number } | null {
  if (typeof value !== "object" || value === null) return null;
  const { w, h } = value as Record<string, unknown>;
  const width = int(w, 1, 20000);
  const height = int(h, 1, 20000);
  return width && height ? { w: width, h: height } : null;
}

function parseTelemetry(value: unknown): ClientTelemetry {
  const t =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const rawUtm =
    typeof t.utm === "object" && t.utm !== null
      ? (t.utm as Record<string, unknown>)
      : {};
  const utm: ClientTelemetry["utm"] = {};
  for (const key of [
    "source",
    "medium",
    "campaign",
    "term",
    "content",
  ] as const) {
    const v = text(rawUtm[key], 100);
    if (v) utm[key] = v;
  }
  const dpr =
    typeof t.dpr === "number" && t.dpr > 0 && t.dpr <= 10
      ? Math.round(t.dpr * 100) / 100
      : null;
  return {
    referrer: text(t.referrer, 300),
    landingPath: text(t.landingPath, 200),
    utm,
    timezone: text(t.timezone, 64),
    language: text(t.language, 35),
    screen: size(t.screen),
    viewport: size(t.viewport),
    dpr,
    timeToSubmitMs: int(t.timeToSubmitMs, 0, 86_400_000),
  };
}

/** Coarse UA sniffing: good enough for "who is interested", not for feature detection. */
function parseUserAgent(
  ua: string,
): Pick<RequestInfo, "browser" | "os" | "device"> {
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\/|CriOS\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Other";
  const os = /iPhone|iPad|iPod/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS X|Macintosh/.test(ua)
          ? "macOS"
          : /Linux|X11/.test(ua)
            ? "Linux"
            : "Other";
  const device = /bot|crawler|spider|headless/i.test(ua)
    ? "bot"
    : /iPad|Tablet/.test(ua)
      ? "tablet"
      : /Mobi|iPhone|Android/.test(ua)
        ? "mobile"
        : ua
          ? "desktop"
          : "unknown";
  return { browser, os, device };
}

function decode(value: string | null): string | null {
  if (!value) return null;
  try {
    return text(decodeURIComponent(value), 100);
  } catch {
    return text(value, 100);
  }
}

function requestInfo(headers: Headers): RequestInfo {
  const userAgent = text(headers.get("user-agent"), 400) ?? "";
  const ip = clientIp(headers);
  return {
    userAgent,
    ...parseUserAgent(userAgent),
    acceptLanguage: text(headers.get("accept-language"), 100),
    // Coarse location from Vercel's edge headers (absent locally).
    country: decode(headers.get("x-vercel-ip-country")),
    region: decode(headers.get("x-vercel-ip-country-region")),
    city: decode(headers.get("x-vercel-ip-city")),
    ipHash: ip ? hashIp(ip) : null,
  };
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return reply(422, { ok: false, error: "invalid_request" });
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return reply(422, { ok: false, error: "invalid_request" });
  }
  if (raw.length > MAX_BODY_BYTES) {
    return reply(422, { ok: false, error: "invalid_request" });
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return reply(422, { ok: false, error: "invalid_request" });
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return reply(422, { ok: false, error: "invalid_request" });
  }

  const input = data as Record<string, unknown>;
  const email =
    typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  if (email.length === 0 || email.length > MAX_EMAIL || !EMAIL_RE.test(email)) {
    return reply(422, { ok: false, error: "invalid_email" });
  }

  // Honeypot: pretend success, store nothing.
  if (
    typeof input.website === "string" &&
    input.website.slice(0, MAX_HONEYPOT)
  ) {
    return reply(200, { ok: true });
  }

  const source = text(input.source, MAX_SOURCE) ?? "landing";
  const info = requestInfo(request.headers);

  try {
    if (await isRateLimited(info.ipHash)) {
      return reply(
        429,
        { ok: false, error: "rate_limited" },
        { "Retry-After": "60" },
      );
    }
    await saveSignup({
      email,
      source,
      client: parseTelemetry(input.telemetry),
      request: info,
    });
  } catch (err) {
    // Log the failure without the email, and never leak details to the client.
    console.error(
      "waitlist: save failed",
      err instanceof Error ? err.message : err,
    );
    return reply(502, { ok: false, error: "unavailable" });
  }

  return reply(200, { ok: true });
}
