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

/** The only shape accepted from the public pilot-request form. */
export const pilotRequestInputSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).email(),
  company: z.string().trim().min(1).max(120).regex(singleLine),
  role: z.enum(pilotRoles),
  workflow: z.string().trim().max(600).regex(multiLine).optional().default(""),
  source: z
    .string()
    .trim()
    .max(64)
    .regex(singleLine)
    .optional()
    .default("landing-pilot"),
  website: z.string().max(256).optional().default(""),
});

/** Runtime schema and TypeScript source of truth for MongoDB waitlist documents. */
export const pilotRequestDocumentSchema = z.object({
  email: z.string().max(254),
  emailDomain: z.string().max(253),
  company: z.string().max(120),
  role: z.enum(pilotRoles),
  workflow: z.string().max(600).nullable(),
  source: z.string().max(64),
  ipHash: z.string().length(32).nullable(),
  createdAt: z.date(),
  lastSeenAt: z.date(),
  submitCount: z.number().int().nonnegative(),
});

export type PilotRequestInput = z.infer<typeof pilotRequestInputSchema>;
export type PilotRequestDocument = z.infer<typeof pilotRequestDocumentSchema>;
