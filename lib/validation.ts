import { z } from "zod";

// Shared request-validation schemas — the TS side of the v1 API contract.
// The contract is defined once here and imported by every route
// handler (validate → service → return). The Python SDK mirrors these shapes
// and is tested against them in the SDK integration suite.

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
  // Optional sweep link: validated same-project + RUNNING at creation.
  sweep_id: z.string().min(1).max(64).optional(),
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

export const requestMediaSchema = z.object({
  key: z.string().min(1).max(128),
  step: z.number().int().min(0),
  mime: z.enum(["image/png", "image/jpeg", "image/webp"]),
  sizeBytes: z.number().int().positive(),
});

export type RequestMediaInput = z.infer<typeof requestMediaSchema>;

export const createWebhookSchema = z.object({
  url: z.string().url().max(2048),
  events: z
    .array(z.enum(["run.finished", "run.crashed"]))
    .min(1)
    .max(2),
});

export type CreateWebhookInput = z.infer<typeof createWebhookSchema>;

const sweepDimSchema = z.union([
  z.object({
    values: z
      .array(z.union([z.string(), z.number(), z.boolean()]))
      .min(2)
      .max(50),
  }),
  z.object({
    min: z.number().finite(),
    max: z.number().finite(),
    scale: z.enum(["linear", "log"]).optional(),
  }),
]);

export const createSweepSchema = z.object({
  name: z.string().min(1).max(128),
  method: z.enum(["GRID", "RANDOM"]),
  space: z.record(z.string(), sweepDimSchema),
});

export type CreateSweepInput = z.infer<typeof createSweepSchema>;
export type SweepSpace = Record<
  string,
  | { values: (string | number | boolean)[] }
  | { min: number; max: number; scale?: "linear" | "log" }
>;

export const setSweepStateSchema = z.object({
  state: z.enum(["FINISHED", "CANCELLED"]),
});

export const batchRunsSchema = z
  .object({
    ids: z.array(z.string().min(1).max(64)).min(1).max(100),
    op: z.enum(["delete", "tag"]),
    tags: z.array(z.string().min(1).max(64)).max(32).optional(),
  })
  .refine(
    (b) => b.op !== "tag" || (b.tags !== undefined && b.tags.length > 0),
    {
      message: "tag op needs a non-empty tags array",
    },
  );

export type BatchRunsInput = z.infer<typeof batchRunsSchema>;

export const updateRunConfigSchema = z.object({
  config: z.record(z.string(), z.unknown()),
});

export type UpdateRunConfigInput = z.infer<typeof updateRunConfigSchema>;

export const logTextSchema = z.object({
  lines: z
    .array(
      z.object({
        stream: z.enum(["stdout", "stderr"]).optional().default("stdout"),
        step: z.number().int().min(0).optional(),
        text: z.string().min(1).max(8192),
      }),
    )
    .min(1)
    .max(500),
});

export type LogTextInput = z.infer<typeof logTextSchema>;

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

export const updateProfileSchema = z
  .object({
    // NOTE: no email/name fields on purpose — both are immutable. Zod
    // strips unknown keys, so sending them changes nothing (tested).
    bio: z.string().max(500).optional(),
    location: z.string().max(128).optional(),
    website: z.string().max(256).optional(),
    twitter: z.string().max(64).optional(),
    github: z.string().max(64).optional(),
  })
  .refine(
    (b) =>
      b.bio !== undefined ||
      b.location !== undefined ||
      b.website !== undefined ||
      b.twitter !== undefined ||
      b.github !== undefined,
    { message: "nothing to update" },
  );

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

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

// Two-phase S3 upload: client-declared file specs (path/size/digest),
// validated before any ticket is minted. Sizes/digests are re-checked on
// complete via HeadObject existence (content trust stays with the uploader,
// like git — tampering only corrupts their own version).
export const artifactInitSchema = z.object({
  name: artifactNameSchema,
  type: z.string().min(1).max(64).optional().default("model"),
  description: z.string().max(2000).optional().default(""),
  project: z.string().min(1).max(128).optional(),
  run_id: z.string().min(1).max(64).optional(),
  files: z
    .array(
      z.object({
        path: z.string().min(1).max(512),
        sizeBytes: z.number().int().positive(),
        digest: z.string().regex(/^[0-9a-f]{64}$/, "sha256 hex digest"),
      }),
    )
    .min(1)
    .max(1000),
});

export type ArtifactInitInput = z.infer<typeof artifactInitSchema>;

export const inviteMemberSchema = z.object({
  email: z.string().email().max(320),
  role: z.enum(["MEMBER", "VIEWER"]).optional().default("MEMBER"),
});

export const updateRoleSchema = z.object({
  role: z.enum(["SUPER_ADMIN", "MEMBER", "VIEWER"]),
});

export const renameMemberSchema = z.object({
  name: z.string().trim().min(1).max(128),
});

export const createKeySchema = z.object({
  label: z.string().min(1).max(128),
});

export const loginSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(256),
});

export type LoginInput = z.infer<typeof loginSchema>;

// Passwords are set in exactly two places (onboarding, invite accept) and
// both share this schema — client checklists mirror these rules, but the
// server is the enforcer. 12+ chars with all four character classes.
export const passwordSchema = z
  .string()
  .min(12, "at least 12 characters")
  .max(256)
  .regex(/[A-Z]/, "an uppercase letter (A-Z)")
  .regex(/[a-z]/, "a lowercase letter (a-z)")
  .regex(/[0-9]/, "a number (0-9)")
  .regex(/[^A-Za-z0-9]/, "a special character");

export const bootstrapSchema = z.object({
  orgName: z.string().min(1).max(128),
  name: z.string().min(1).max(128),
  email: z.string().email().max(320),
  password: passwordSchema,
});

export type BootstrapInput = z.infer<typeof bootstrapSchema>;

export const onboardingSettingsSchema = z.object({
  disabled: z.boolean(),
});

export const acceptInviteSchema = z.object({
  token: z.string().min(1),
  password: passwordSchema,
  // One-time display-name claim: required at accept, locked after.
  name: z.string().trim().min(1).max(128),
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

export const overlayChartSchema = z.object({
  key: z.string().min(1).max(256),
  runs: z
    .string()
    .min(1)
    .max(1024)
    .transform((s) => [
      ...new Set(
        s
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean),
      ),
    ])
    .refine((ids) => ids.length >= 1 && ids.length <= 10, {
      message: "1–10 run ids",
    }),
  max_points: z.coerce.number().int().min(1).max(2000).optional().default(500),
});

export type OverlayChartQuery = z.infer<typeof overlayChartSchema>;

export const exportQuerySchema = z.object({
  format: z.enum(["csv", "json"]).optional().default("csv"),
  key: z.string().min(1).max(256).optional(),
});

export type ExportQuery = z.infer<typeof exportQuerySchema>;
