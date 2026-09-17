import { z } from "zod";

// Shared request-validation schemas — the TS side of the §6 API contract.
// PRD §10.1: the contract is defined once here and imported by every route
// handler (validate → service → return). The Python SDK mirrors these shapes
// and is tested against them (SDK integration suite, §10.2).

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const projectSlugSchema = z
  .string()
  .min(1)
  .max(128)
  .refine((s) => slugRegex.test(s.toLowerCase().replace(/_/g, "-")), {
    message: "must be a URL-safe slug",
  });

export const createRunSchema = z.object({
  project: z.string().min(1).max(128),
  name: z.string().min(1).max(128).optional(),
  config: z.record(z.string(), z.unknown()).optional().default({}),
  tags: z.array(z.string().min(1).max(64)).max(32).optional().default([]),
});

export type CreateRunInput = z.infer<typeof createRunSchema>;

export const logPointSchema = z.object({
  key: z.string().min(1).max(256),
  step: z.number().int().nonnegative(),
  value: z.number().finite(),
  wall_time: z.string().datetime().optional(),
});

export const logBatchSchema = z.object({
  points: z.array(logPointSchema).min(1).max(1000),
});

export type LogBatchInput = z.infer<typeof logBatchSchema>;

export const finishRunSchema = z.object({
  status: z.enum(["finished", "crashed", "killed"]),
});

export type FinishRunInput = z.infer<typeof finishRunSchema>;

export const inviteMemberSchema = z.object({
  email: z.string().email().max(320),
});

export const updateRoleSchema = z.object({
  role: z.enum(["SUPER_ADMIN", "MEMBER"]),
});

export const createKeySchema = z.object({
  label: z.string().min(1).max(128),
});

export const createProjectSchema = z.object({
  name: z.string().min(1).max(128),
  slug: z
    .string()
    .min(1)
    .max(128)
    .optional(),
});

export const metricsQuerySchema = z.object({
  key: z.string().min(1).max(256),
  max_points: z.coerce.number().int().min(1).max(10000).optional(),
  after_step: z.coerce.number().int().nonnegative().optional(),
});
