/** Public waitlist endpoint: validate, enrich, rate-limit, and store in MongoDB. */
import {
  requestInfoSchema,
  waitlistInputSchema,
  type RequestInfo,
} from "@/lib/waitlist-schema";
import {
  clientIp,
  hashIp,
  isRateLimited,
  saveWaitlistEntry,
} from "@/lib/waitlist";

const MAX_BODY_BYTES = 4096;

function reply(status: number, error?: string) {
  return Response.json(error ? { ok: false, error } : { ok: true }, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function text(value: string | null, max: number): string | null {
  if (!value) return null;
  const clean = value
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, max);
  return clean || null;
}

function parseUserAgent(
  userAgent: string,
): Pick<RequestInfo, "browser" | "os" | "device"> {
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /OPR\/|Opera/.test(userAgent)
      ? "Opera"
      : /Firefox\//.test(userAgent)
        ? "Firefox"
        : /Chrome\/|CriOS\//.test(userAgent)
          ? "Chrome"
          : /Safari\//.test(userAgent)
            ? "Safari"
            : "Other";
  const os = /iPhone|iPad|iPod/.test(userAgent)
    ? "iOS"
    : /Android/.test(userAgent)
      ? "Android"
      : /Windows/.test(userAgent)
        ? "Windows"
        : /Mac OS X|Macintosh/.test(userAgent)
          ? "macOS"
          : /Linux|X11/.test(userAgent)
            ? "Linux"
            : "Other";
  const device = /bot|crawler|spider|headless/i.test(userAgent)
    ? "bot"
    : /iPad|Tablet/.test(userAgent)
      ? "tablet"
      : /Mobi|iPhone|Android/.test(userAgent)
        ? "mobile"
        : userAgent
          ? "desktop"
          : "unknown";
  return { browser, os, device };
}

function decodeLocation(value: string | null): string | null {
  if (!value) return null;
  try {
    return text(decodeURIComponent(value), 100);
  } catch {
    return text(value, 100);
  }
}

function buildRequestInfo(
  headers: Headers,
  ipHash: string | null,
): RequestInfo {
  const userAgent = text(headers.get("user-agent"), 400) ?? "";
  return requestInfoSchema.parse({
    userAgent,
    ...parseUserAgent(userAgent),
    acceptLanguage: text(headers.get("accept-language"), 100),
    country: decodeLocation(headers.get("x-vercel-ip-country")),
    region: decodeLocation(headers.get("x-vercel-ip-country-region")),
    city: decodeLocation(headers.get("x-vercel-ip-city")),
    ipHash,
  });
}

export async function POST(request: Request) {
  if (
    !(request.headers.get("content-type") ?? "")
      .toLowerCase()
      .startsWith("application/json")
  ) {
    return reply(422, "invalid_request");
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return reply(422, "invalid_request");
  }
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return reply(413, "request_too_large");
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return reply(422, "invalid_request");
  }
  const parsed = waitlistInputSchema.safeParse(json);
  if (!parsed.success) return reply(422, "invalid_request");

  // Honeypot: look successful and store nothing.
  if (parsed.data.website.trim()) return reply(200);

  try {
    const ip = clientIp(request.headers);
    const ipHash = ip ? hashIp(ip) : null;
    if (await isRateLimited(ipHash)) {
      const response = reply(429, "rate_limited");
      response.headers.set("Retry-After", "60");
      return response;
    }
    await saveWaitlistEntry({
      email: parsed.data.email,
      company: parsed.data.company || null,
      role: parsed.data.role || null,
      workflow: parsed.data.workflow || null,
      client: parsed.data.client,
      request: buildRequestInfo(request.headers, ipHash),
      source: parsed.data.source,
      ipHash,
    });
    return reply(200);
  } catch (error) {
    // Never log the submitted email or company name.
    console.error(
      "waitlist: storage unavailable",
      error instanceof Error ? error.name : "unknown error",
    );
    return reply(502, "unavailable");
  }
}
