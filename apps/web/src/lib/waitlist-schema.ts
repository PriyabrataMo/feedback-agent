import { z } from "zod";

export const pilotRoles = [
  "founder",
  "support",
  "engineering",
  "product",
  "other",
] as const;

const singleLine = /^[^\u0000-\u001f\u007f]*$/;
const multiLine = /^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/;
const optionalQualification = z
  .string()
  .trim()
  .max(120)
  .regex(singleLine)
  .optional()
  .default("");
const dimensionsSchema = z
  .object({
    w: z.number().int().min(1).max(20_000),
    h: z.number().int().min(1).max(20_000),
  })
  .nullable();

export const clientTelemetrySchema = z.object({
  referrer: z.string().max(300).nullable(),
  landingPath: z.string().max(200).nullable(),
  utm: z
    .object({
      source: z.string().max(100).optional(),
      medium: z.string().max(100).optional(),
      campaign: z.string().max(100).optional(),
      term: z.string().max(100).optional(),
      content: z.string().max(100).optional(),
    })
    .default({}),
  timezone: z.string().max(64).nullable(),
  language: z.string().max(35).nullable(),
  screen: dimensionsSchema,
  viewport: dimensionsSchema,
  dpr: z.number().positive().max(10).nullable(),
  timeToSubmitMs: z.number().int().min(0).max(86_400_000).nullable(),
});

const emptyClientTelemetry = {
  referrer: null,
  landingPath: null,
  utm: {},
  timezone: null,
  language: null,
  screen: null,
  viewport: null,
  dpr: null,
  timeToSubmitMs: null,
};

export const requestInfoSchema = z.object({
  userAgent: z.string().max(400),
  browser: z.string().max(30),
  os: z.string().max(30),
  device: z.enum(["mobile", "tablet", "desktop", "bot", "unknown"]),
  acceptLanguage: z.string().max(100).nullable(),
  country: z.string().max(100).nullable(),
  region: z.string().max(100).nullable(),
  city: z.string().max(100).nullable(),
  ipHash: z.string().length(32).nullable(),
});

/** Email is the only required visitor-provided field. */
export const waitlistInputSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).email(),
  company: optionalQualification,
  role: z.enum(pilotRoles).or(z.literal("")).optional().default(""),
  workflow: z.string().trim().max(600).regex(multiLine).optional().default(""),
  source: z
    .string()
    .trim()
    .max(64)
    .regex(singleLine)
    .optional()
    .default("landing-waitlist"),
  website: z.string().max(256).optional().default(""),
  client: clientTelemetrySchema.optional().default(emptyClientTelemetry),
});

/** Runtime schema and TypeScript source of truth for MongoDB waitlist documents. */
export const waitlistDocumentSchema = z.object({
  email: z.string().max(254),
  emailDomain: z.string().max(253),
  company: z.string().max(120).nullable().optional(),
  role: z.enum(pilotRoles).nullable().optional(),
  workflow: z.string().max(600).nullable().optional(),
  client: clientTelemetrySchema,
  request: requestInfoSchema,
  source: z.string().max(64),
  ipHash: z.string().length(32).nullable(),
  createdAt: z.date(),
  lastSeenAt: z.date(),
  submitCount: z.number().int().nonnegative(),
});

export type ClientTelemetry = z.infer<typeof clientTelemetrySchema>;
export type RequestInfo = z.infer<typeof requestInfoSchema>;
export type WaitlistInput = z.infer<typeof waitlistInputSchema>;
export type WaitlistDocument = z.infer<typeof waitlistDocumentSchema>;
