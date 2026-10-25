import { createHmac } from "node:crypto";
import "server-only";
import { getDb } from "@/lib/mongo";
import {
  waitlistDocumentSchema,
  type WaitlistDocument,
} from "@/lib/waitlist-schema";

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
    .catch((error: unknown) => {
      indexesReady = undefined;
      throw error;
    });
  return indexesReady;
}

/** A salted HMAC supports abuse controls without retaining the raw IP address. */
export function hashIp(ip: string): string {
  const salt = process.env.WAITLIST_IP_SALT;
  if (!salt && process.env.NODE_ENV === "production") {
    throw new Error("WAITLIST_IP_SALT is not set");
  }
  return createHmac("sha256", salt ?? "dev-only-salt")
    .update(ip)
    .digest("hex")
    .slice(0, 32);
}

export function clientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || null;
}

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

type SaveWaitlistEntry = Pick<
  WaitlistDocument,
  "email" | "client" | "request" | "source" | "ipHash"
> &
  Pick<WaitlistDocument, "company" | "role" | "workflow">;

/** Insert a signup and enrich it when the same person later adds optional pilot details. */
export async function saveWaitlistEntry(
  request: SaveWaitlistEntry,
): Promise<void> {
  await ensureIndexes();
  const now = new Date();
  const document = waitlistDocumentSchema.parse({
    ...request,
    emailDomain: request.email.split("@")[1] ?? "",
    createdAt: now,
    lastSeenAt: now,
    submitCount: 1,
  });
  const collection = (await getDb()).collection<WaitlistDocument>("waitlist");
  const updates: Partial<WaitlistDocument> = {
    client: document.client,
    request: document.request,
    source: document.source,
    ipHash: document.ipHash,
    lastSeenAt: document.lastSeenAt,
  };
  // An email-only signup must not erase qualification supplied on an earlier visit.
  if (document.company) updates.company = document.company;
  if (document.role) updates.role = document.role;
  if (document.workflow) updates.workflow = document.workflow;

  try {
    await collection.updateOne(
      { email: document.email },
      {
        $setOnInsert: {
          email: document.email,
          emailDomain: document.emailDomain,
          createdAt: document.createdAt,
        },
        $set: updates,
        $inc: { submitCount: 1 },
      },
      { upsert: true },
    );
  } catch (error) {
    // Simultaneous first submits can race on the unique index; one has already landed.
    if ((error as { code?: number }).code === 11000) return;
    throw error;
  }
}
