import { createHmac } from "node:crypto";
import { getDb } from "@/lib/mongo";

/** Everything the browser tells us. Untrusted: every field is validated and truncated. */
export type ClientTelemetry = {
  referrer: string | null;
  landingPath: string | null;
  utm: Partial<
    Record<"source" | "medium" | "campaign" | "term" | "content", string>
  >;
  timezone: string | null;
  language: string | null;
  screen: { w: number; h: number } | null;
  viewport: { w: number; h: number } | null;
  dpr: number | null;
  timeToSubmitMs: number | null;
};

export type RequestInfo = {
  userAgent: string;
  browser: string;
  os: string;
  device: "mobile" | "tablet" | "desktop" | "bot" | "unknown";
  acceptLanguage: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  ipHash: string | null;
};

export type Signup = {
  email: string;
  source: string;
  client: ClientTelemetry;
  request: RequestInfo;
};

type WaitlistDoc = Signup & {
  emailDomain: string;
  createdAt: Date;
  lastSeenAt: Date;
  submitCount: number;
};

const RATE_PER_MINUTE = 5;
const HIT_TTL_SECONDS = 3600;

let indexesReady: Promise<void> | undefined;

function ensureIndexes(): Promise<void> {
  indexesReady ??= getDb()
    .then(async (db) => {
      await Promise.all([
        db.collection("waitlist").createIndex({ email: 1 }, { unique: true }),
        db.collection("waitlist").createIndex({ createdAt: -1 }),
        db
          .collection("waitlist_hits")
          .createIndex({ at: 1 }, { expireAfterSeconds: HIT_TTL_SECONDS }),
        db.collection("waitlist_hits").createIndex({ ipHash: 1, at: -1 }),
      ]);
    })
    .catch((err: unknown) => {
      indexesReady = undefined;
      throw err;
    });
  return indexesReady;
}

/** Salted HMAC of the IP: enough for abuse checks and unique-visitor counts, no raw IP kept. */
export function hashIp(ip: string): string {
  const salt = process.env.WAITLIST_IP_SALT ?? "dev-only-salt";
  return createHmac("sha256", salt).update(ip).digest("hex").slice(0, 32);
}

export function clientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || null;
}

/** Counts this attempt and reports whether the caller is over the per-minute limit. */
export async function isRateLimited(ipHash: string | null): Promise<boolean> {
  if (!ipHash) return false;
  await ensureIndexes();
  const hits = (await getDb()).collection("waitlist_hits");
  const since = new Date(Date.now() - 60_000);
  const recent = await hits.countDocuments({ ipHash, at: { $gte: since } });
  if (recent >= RATE_PER_MINUTE) return true;
  await hits.insertOne({ ipHash, at: new Date() });
  return false;
}

/** Inserts a new signup, or bumps `submitCount`/`lastSeenAt` if the email is already on the list. */
export async function saveSignup(signup: Signup): Promise<void> {
  await ensureIndexes();
  const now = new Date();
  const collection = (await getDb()).collection<WaitlistDoc>("waitlist");
  try {
    await collection.updateOne(
      { email: signup.email },
      {
        $setOnInsert: {
          email: signup.email,
          emailDomain: signup.email.split("@")[1] ?? "",
          source: signup.source,
          client: signup.client,
          request: signup.request,
          createdAt: now,
        },
        $set: { lastSeenAt: now },
        $inc: { submitCount: 1 },
      },
      { upsert: true },
    );
  } catch (err) {
    // Two simultaneous first-time submits can race on the unique index: the other one won.
    if ((err as { code?: number }).code === 11000) return;
    throw err;
  }
}
