/** Public pilot-request endpoint: validate, rate-limit, and store in MongoDB. */
import { pilotRequestInputSchema } from "@/lib/waitlist-schema";
import {
  clientIp,
  hashIp,
  isRateLimited,
  savePilotRequest,
} from "@/lib/waitlist";

const MAX_BODY_BYTES = 4096;

function reply(status: number, error?: string) {
  return Response.json(error ? { ok: false, error } : { ok: true }, {
    status,
    headers: { "Cache-Control": "no-store" },
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
  const parsed = pilotRequestInputSchema.safeParse(json);
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
    await savePilotRequest({
      email: parsed.data.email,
      company: parsed.data.company,
      role: parsed.data.role,
      workflow: parsed.data.workflow || null,
      source: parsed.data.source,
      ipHash,
    });
    return reply(200);
  } catch (error) {
    // Never log the submitted email or company name.
    console.error(
      "pilot request: storage unavailable",
      error instanceof Error ? error.name : "unknown error",
    );
    return reply(502, "unavailable");
  }
}
