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
  // Optional group slug: the run is then visible only to group members
  // (and super admins). Caller must belong to the group.
  group: z.string().min(1).max(128).optional(),
});

export type CreateRunInput = z.infer<typeof createRunSchema>;

export const logPointSchema = z.object({
  key: z.string().min(1).max(256),
  step: z.number().int().nonnegative(),
  value: z.number().finite(),
  // offset:true — Python's datetime.isoformat() emits +00:00, not Z.
  wall_time: z.string().datetime({ offset: true }).optional(),
});

export const logBatchSchema = z.object({
  points: z.array(logPointSchema).min(1).max(1000),
});

export type LogBatchInput = z.infer<typeof logBatchSchema>;

export const finishRunSchema = z.object({
  status: z.enum(["finished", "crashed", "killed"]),
});

export type FinishRunInput = z.infer<typeof finishRunSchema>;

export const updateRunSchema = z
  .object({
    name: z.string().min(1).max(128).optional(),
    tags: z.array(z.string().min(1).max(64)).max(32).optional(),
    notes: z.string().max(2000).optional(),
  })
  .refine(
    (b) =>
      b.name !== undefined || b.tags !== undefined || b.notes !== undefined,
    { message: "nothing to update" },
  );

export type UpdateRunInput = z.infer<typeof updateRunSchema>;

export const runListSortSchema = z
  .enum(["recent", "oldest", "name_asc", "name_desc"])
  .optional()
  .default("recent");

export type RunListSort = z.infer<typeof runListSortSchema>;

export const renameProjectSchema = z.object({
  name: z.string().min(1).max(128),
});

export const updateProjectSchema = z
  .object({
    name: z.string().min(1).max(128).optional(),
    // Move between groups (null = org-wide public). Super-admin-only,
    // enforced server-side alongside the rename permission.
    group: z.string().min(1).max(128).nullable().optional(),
  })
  .refine((b) => b.name !== undefined || b.group !== undefined, {
    message: "nothing to update",
  });

export const groupSlugSchema = z
  .string()
  .min(1)
  .max(128)
  .refine(
    (s) =>
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s.toLowerCase().replace(/_/g, "-")),
    {
      message: "must be a URL-safe slug",
    },
  );

export const createGroupSchema = z.object({
  name: z.string().min(1).max(128),
  slug: groupSlugSchema.optional(),
  description: z.string().max(500).optional().default(""),
});

export const updateGroupSchema = z
  .object({
    name: z.string().min(1).max(128).optional(),
    description: z.string().max(500).optional(),
  })
  .refine((b) => b.name !== undefined || b.description !== undefined, {
    message: "nothing to update",
  });

export const addGroupMemberSchema = z.object({
  email: z.string().email().max(320),
});

export const artifactNameSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._-]+$/, {
    message: "letters, numbers, dot, underscore, dash only (URL-safe)",
  });

// Multipart upload fields arrive as strings — validated here, files separately.
export const artifactUploadFieldsSchema = z.object({
  name: artifactNameSchema,
  type: z.string().min(1).max(64).optional().default("model"),
  description: z.string().max(2000).optional().default(""),
  project: z.string().min(1).max(128).optional(),
  run_id: z.string().min(1).optional(),
});

export type ArtifactUploadFields = z.infer<typeof artifactUploadFieldsSchema>;

export const inviteMemberSchema = z.object({
  email: z.string().email().max(320),
});

export const updateRoleSchema = z.object({
  role: z.enum(["SUPER_ADMIN", "MEMBER"]),
});

export const createKeySchema = z.object({
  label: z.string().min(1).max(128),
});

export const loginSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(256),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const bootstrapSchema = z.object({
  orgName: z.string().min(1).max(128),
  name: z.string().min(1).max(128),
  email: z.string().email().max(320),
  password: z.string().min(8).max(256),
});

export type BootstrapInput = z.infer<typeof bootstrapSchema>;

export const onboardingSettingsSchema = z.object({
  disabled: z.boolean(),
});

export const acceptInviteSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(256),
});

export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;

export const createProjectSchema = z.object({
  name: z.string().min(1).max(128),
  slug: projectSlugSchema.optional(),
  // Optional group slug: members may create inside their own groups.
  group: z.string().min(1).max(128).optional(),
});

export const metricsQuerySchema = z.object({
  key: z.string().min(1).max(256),
  max_points: z.coerce.number().int().min(1).max(10000).optional(),
  after_step: z.coerce.number().int().nonnegative().optional(),
});

export const exportQuerySchema = z.object({
  format: z.enum(["csv", "json"]).optional().default("csv"),
  key: z.string().min(1).max(256).optional(),
});

export type ExportQuery = z.infer<typeof exportQuerySchema>;
