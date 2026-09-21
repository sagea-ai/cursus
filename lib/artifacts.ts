import { createHash } from "node:crypto";

import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/http";
import {
  assertProjectActive,
  canWriteGroup,
  projectVisibilityFilter,
  runVisibilityFilter,
  type GroupAuth,
} from "@/lib/groups";
import { slugify } from "@/lib/slug";
import {
  deleteObjects,
  headObject,
  presignGet,
  presignPut,
  storageEnabled,
} from "@/lib/storage";
import type { ArtifactUploadFields } from "@/lib/validation";

// Artifacts: run-attached versioned files. Deliberately NOT a registry:
// no aliases, no lineage edges, no cross-project linking.
//
// Bytes live in object storage (lib/storage.ts), metadata in Postgres —
// the server only signs presigned URLs, clients PUT/GET direct. Two-phase
// upload (init → PUT → complete) keeps storage leak-free: PENDING rows
// hold no bytes, re-inits allocate new versions, stale PENDING versions
// are swept lazily. Rows predating this flow keep inline DB bytes and
// download straight from Postgres.

export const MAX_ARTIFACT_FILE_BYTES = 1024 * 1024 * 1024; // 1 GB
export const MAX_FILES_PER_VERSION = 1000;

export interface UploadFileSpec {
  path: string;
  sizeBytes: number;
  digest: string;
}

function cleanPath(raw: string): string {
  const path = raw.trim().replace(/\\/g, "/");
  if (!path || path.startsWith("/") || path.split("/").includes("..")) {
    throw new ApiError(400, `invalid file path: ${raw}`);
  }
  return path;
}

function requireStorage(): void {
  if (!storageEnabled()) {
    throw new ApiError(
      503,
      "artifacts require object storage (S3_ENDPOINT/S3_ACCESS_KEY/S3_SECRET_KEY)",
    );
  }
}

/** Content-addressed object key: identical bytes dedupe to one object. */
export function artifactStorageKey(
  orgId: string,
  artifactId: string,
  version: number,
  digest: string,
): string {
  return `artifacts/${orgId}/${artifactId}/v${version}/${digest}`;
}

export interface CreatedVersion {
  artifact: { id: string; name: string; type: string };
  version: {
    version: number;
    digest: string;
    sizeBytes: number;
    fileCount: number;
    createdByRunId: string | null;
  };
  files: { id: string; path: string; sizeBytes: number }[];
}

export interface UploadTicket {
  id: string;
  path: string;
  url: string;
  headers: { "Content-Type": string };
}

export interface RequestedVersion {
  artifact: { id: string; name: string; type: string };
  version: {
    id: string;
    version: number;
    digest: string;
    sizeBytes: number;
    fileCount: number;
    createdByRunId: string | null;
  };
  files: UploadTicket[];
}

async function resolveUploadProject(
  auth: GroupAuth & { userId: string },
  fields: ArtifactUploadFields,
): Promise<{ projectId: string; runId: string | null; orgId: string }> {
  // Resolve the owning project: explicit slug wins, else the run's project.
  let projectId: string | null = null;
  let runId: string | null = null;
  if (fields.run_id) {
    // Attaching to a run you cannot see is a 404 (same oracle rule).
    const run = await db.run.findFirst({
      where: {
        id: fields.run_id,
        project: { orgId: auth.orgId },
        ...runVisibilityFilter(auth),
      },
      select: { id: true, projectId: true },
    });
    if (!run) throw new ApiError(404, "run not found");
    runId = run.id;
    projectId = run.projectId;
  }
  if (fields.project) {
    const slug = slugify(fields.project);
    const project = await db.project.findFirst({
      where: {
        orgId: auth.orgId,
        slug,
        ...projectVisibilityFilter(auth),
      },
      select: { id: true, groupId: true },
    });
    if (!project) throw new ApiError(404, "project not found");
    if (projectId && projectId !== project.id) {
      throw new ApiError(400, "run_id and project disagree");
    }
    if (
      project.groupId &&
      auth.role !== "SUPER_ADMIN" &&
      !(await canWriteGroup(auth, project.groupId))
    ) {
      throw new ApiError(403, "not a member of this project's group");
    }
    projectId = project.id;
  }
  if (!projectId) throw new ApiError(400, "project or run_id is required");
  const orgId = auth.orgId;
  await assertProjectActive(projectId);
  // Run-resolved projects inherit the same write rule: grouped projects
  // need membership, not just visibility.
  const owner = await db.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { groupId: true },
  });
  if (
    owner.groupId &&
    auth.role !== "SUPER_ADMIN" &&
    !(await canWriteGroup(auth, owner.groupId))
  ) {
    throw new ApiError(403, "not a member of this project's group");
  }
  return { projectId, runId, orgId };
}

/** Phase 1: validate, allocate the version, mint PUT tickets. Bytes flow
 * client → storage; the server never sees them (no body limits, no memory
 * spikes). Re-inits allocate a fresh version; stale PENDING versions are
 * swept lazily (their objects were never uploaded, so nothing leaks). */
export async function requestArtifactUpload(
  auth: GroupAuth & { userId: string },
  fields: ArtifactUploadFields,
  specs: UploadFileSpec[],
): Promise<RequestedVersion> {
  requireRole(auth, "MEMBER");
  requireStorage();
  if (specs.length === 0) throw new ApiError(400, "no files uploaded");
  if (specs.length > MAX_FILES_PER_VERSION) {
    throw new ApiError(
      400,
      `at most ${MAX_FILES_PER_VERSION} files per version`,
    );
  }
  const { projectId, runId, orgId } = await resolveUploadProject(auth, fields);

  const seen = new Set<string>();
  const files = specs.map((s) => {
    const path = cleanPath(s.path);
    if (seen.has(path)) throw new ApiError(400, `duplicate path: ${path}`);
    seen.add(path);
    if (!Number.isInteger(s.sizeBytes) || s.sizeBytes < 1) {
      throw new ApiError(400, `empty file: ${path}`);
    }
    if (s.sizeBytes > MAX_ARTIFACT_FILE_BYTES) {
      throw new ApiError(413, `file too large (max 1 GB): ${path}`);
    }
    if (!/^[0-9a-f]{64}$/.test(s.digest)) {
      throw new ApiError(400, `bad sha256 digest: ${path}`);
    }
    return { path, sizeBytes: s.sizeBytes, digest: s.digest };
  });
  const digest = createHash("sha256")
    .update(
      files
        .map((f) => `${f.path}:${f.digest}`)
        .sort()
        .join("\n"),
    )
    .digest("hex");
  const sizeBytes = files.reduce((n, f) => n + BigInt(f.sizeBytes), BigInt(0));

  // Version allocation races under concurrent uploads of the same artifact
  // name: unique(artifactId, version) rejects the loser, which retries.
  for (let attempt = 0; attempt < 3; attempt++) {
    const artifact = await db.artifact.upsert({
      where: { projectId_name: { projectId, name: fields.name } },
      update: {},
      create: {
        projectId,
        name: fields.name,
        type: fields.type,
        description: fields.description,
        createdById: auth.userId,
      },
      select: { id: true, name: true, type: true },
    });
    const max = await db.artifactVersion.aggregate({
      _max: { version: true },
      where: { artifactId: artifact.id },
    });
    const next = (max._max.version ?? 0) + 1;
    try {
      const created = await db.artifactVersion.create({
        data: {
          artifactId: artifact.id,
          version: next,
          digest,
          sizeBytes,
          fileCount: files.length,
          description: fields.description,
          createdByRunId: runId,
          status: "PENDING",
          files: {
            create: files.map((f) => ({
              path: f.path,
              sizeBytes: f.sizeBytes,
              digest: f.digest,
              storageKey: artifactStorageKey(
                orgId,
                artifact.id,
                next,
                f.digest,
              ),
            })),
          },
        },
        select: {
          id: true,
          version: true,
          digest: true,
          sizeBytes: true,
          fileCount: true,
          createdByRunId: true,
          files: { select: { id: true, path: true, storageKey: true } },
        },
      });
      // Lazy orphan sweep: PENDING versions whose PUTs never arrived.
      await db.artifactVersion.deleteMany({
        where: {
          artifactId: artifact.id,
          status: "PENDING",
          id: { not: created.id },
          createdAt: { lt: new Date(Date.now() - 24 * 3600_000) },
        },
      });
      const expiresIn = 3600;
      const tickets = await Promise.all(
        created.files.map(async (f) => ({
          id: f.id,
          path: f.path,
          url: await presignPut(
            f.storageKey!,
            "application/octet-stream",
            expiresIn,
          ),
          headers: { "Content-Type": "application/octet-stream" } as const,
        })),
      );
      return {
        artifact,
        version: {
          id: created.id,
          version: created.version,
          digest: created.digest,
          sizeBytes: Number(created.sizeBytes),
          fileCount: created.fileCount,
          createdByRunId: created.createdByRunId,
        },
        files: tickets,
      };
    } catch (e) {
      const conflict =
        typeof e === "object" &&
        e !== null &&
        "code" in e &&
        (e as { code: string }).code === "P2002";
      if (conflict && attempt < 2) continue;
      throw e;
    }
  }
  throw new ApiError(409, "version conflict, retry the upload");
}

/** Phase 2: verify every object landed, then flip COMPLETED. Missing
 * objects 409 with their paths (PUT first, then complete). Idempotent —
 * completing twice returns the same version. */
export async function completeArtifactUpload(
  auth: GroupAuth & { userId: string },
  versionId: string,
): Promise<CreatedVersion> {
  requireRole(auth, "MEMBER");
  requireStorage();
  // Recheck current group access at completion, including completed retries:
  // membership may have changed since the upload ticket was issued.
  const version = await db.artifactVersion.findFirst({
    where: {
      id: versionId,
      artifact: {
        project: {
          orgId: auth.orgId,
          ...projectVisibilityFilter(auth),
        },
      },
    },
    select: {
      id: true,
      version: true,
      digest: true,
      sizeBytes: true,
      fileCount: true,
      createdByRunId: true,
      status: true,
      artifact: { select: { id: true, name: true, type: true } },
      files: {
        select: { id: true, path: true, sizeBytes: true, storageKey: true },
      },
    },
  });
  if (!version) throw new ApiError(404, "version not found");
  if (version.status === "COMPLETED") return toCreatedVersion(version);
  const missing: string[] = [];
  for (const f of version.files) {
    if (!f.storageKey) continue;
    const head = await headObject(f.storageKey);
    if (!head) {
      missing.push(f.path);
      continue;
    }
    // Cap enforced on actual bytes (claims are uploader-declared): abusive
    // objects are rejected and the version row goes with them.
    if (head.size > MAX_ARTIFACT_FILE_BYTES) {
      await db.artifactVersion.delete({ where: { id: version.id } });
      await deleteObjects(
        version.files
          .map((x) => x.storageKey)
          .filter((k): k is string => k !== null),
      ).catch(() => 0);
      throw new ApiError(413, `file too large (max 1 GB): ${f.path}`);
    }
  }
  if (missing.length > 0) {
    throw new ApiError(
      409,
      `bytes missing for: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? "…" : ""} — PUT to the ticket URLs first`,
    );
  }
  const updated = await db.artifactVersion.update({
    where: { id: version.id },
    data: { status: "COMPLETED" },
    select: {
      version: true,
      digest: true,
      sizeBytes: true,
      fileCount: true,
      createdByRunId: true,
    },
  });
  return toCreatedVersion({
    ...version,
    ...updated,
    artifact: version.artifact,
  });
}

function toCreatedVersion(v: {
  artifact: { id: string; name: string; type: string };
  version: number;
  digest: string;
  sizeBytes: bigint | number;
  fileCount: number;
  createdByRunId: string | null;
  files: { id: string; path: string; sizeBytes: bigint | number }[];
}): CreatedVersion {
  return {
    artifact: v.artifact,
    version: {
      version: v.version,
      digest: v.digest,
      sizeBytes: Number(v.sizeBytes),
      fileCount: v.fileCount,
      createdByRunId: v.createdByRunId,
    },
    files: v.files.map((f) => ({
      id: f.id,
      path: f.path,
      sizeBytes: Number(f.sizeBytes),
    })),
  };
}

/** Purge every object for an artifact's versions (project delete already
 * cascades the rows; callers use this so bytes don't orphan). */
export async function purgeArtifactObjects(
  artifactId: string,
): Promise<number> {
  const rows = await db.artifactFile.findMany({
    where: { version: { artifactId }, storageKey: { not: null } },
    select: { storageKey: true },
  });
  if (rows.length === 0) return 0;
  return deleteObjects(
    rows.map((row) => row.storageKey).filter((k): k is string => k !== null),
  );
}

export interface ArtifactSummary {
  id: string;
  name: string;
  type: string;
  description: string;
  versionCount: number;
  updatedAt: Date;
  latest: {
    version: number;
    digest: string;
    sizeBytes: number;
    fileCount: number;
    createdAt: Date;
  } | null;
}

export async function listArtifacts(
  auth: { orgId: string },
  projectSlug: string,
): Promise<ArtifactSummary[]> {
  const project = await db.project.findUnique({
    where: { orgId_slug: { orgId: auth.orgId, slug: projectSlug } },
    select: { id: true },
  });
  if (!project) throw new ApiError(404, "project not found");
  const artifacts = await db.artifact.findMany({
    where: { projectId: project.id },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      type: true,
      description: true,
      createdAt: true,
    },
  });
  if (artifacts.length === 0) return [];
  // Completed-version counts (PENDING uploads don't inflate the list).
  const counts = await db.artifactVersion.groupBy({
    by: ["artifactId"],
    where: {
      artifactId: { in: artifacts.map((a) => a.id) },
      status: "COMPLETED",
    },
    _count: { _all: true },
  });
  const countByArtifact = new Map(
    counts.map((c) => [c.artifactId, c._count._all]),
  );
  // One batched versions query, latest COMPLETED picked in JS — not N+1.
  // PENDING uploads never surface in lists (nothing viewable yet).
  const versions = await db.artifactVersion.findMany({
    where: {
      artifactId: { in: artifacts.map((a) => a.id) },
      status: "COMPLETED",
    },
    orderBy: [{ artifactId: "asc" }, { version: "desc" }],
    select: {
      artifactId: true,
      version: true,
      digest: true,
      sizeBytes: true,
      fileCount: true,
      createdAt: true,
    },
  });
  const latestByArtifact = new Map<string, (typeof versions)[number]>();
  for (const v of versions) {
    if (!latestByArtifact.has(v.artifactId))
      latestByArtifact.set(v.artifactId, v);
  }
  return artifacts.map((a) => {
    const latest = latestByArtifact.get(a.id);
    return {
      id: a.id,
      name: a.name,
      type: a.type,
      description: a.description,
      versionCount: countByArtifact.get(a.id) ?? 0,
      updatedAt: latest?.createdAt ?? a.createdAt,
      latest: latest
        ? {
            version: latest.version,
            digest: latest.digest,
            sizeBytes: Number(latest.sizeBytes),
            fileCount: latest.fileCount,
            createdAt: latest.createdAt,
          }
        : null,
    };
  });
}

export interface ArtifactDetail {
  id: string;
  name: string;
  type: string;
  description: string;
  project: { slug: string; name: string };
  versions: {
    version: number;
    digest: string;
    sizeBytes: number;
    fileCount: number;
    description: string;
    createdByRunId: string | null;
    createdByRunName: string | null;
    createdAt: Date;
  }[];
  selected: {
    version: number;
    files: { id: string; path: string; sizeBytes: number; digest: string }[];
  };
}

export async function getArtifactDetail(
  auth: { orgId: string },
  projectSlug: string,
  name: string,
  versionSel: number | "latest",
): Promise<ArtifactDetail> {
  const project = await db.project.findUnique({
    where: { orgId_slug: { orgId: auth.orgId, slug: projectSlug } },
    select: { id: true, slug: true, name: true },
  });
  if (!project) throw new ApiError(404, "project not found");
  const artifact = await db.artifact.findUnique({
    where: { projectId_name: { projectId: project.id, name } },
    select: {
      id: true,
      name: true,
      type: true,
      description: true,
      versions: {
        where: { status: "COMPLETED" },
        orderBy: { version: "desc" },
        select: {
          id: true,
          version: true,
          digest: true,
          sizeBytes: true,
          fileCount: true,
          description: true,
          createdByRunId: true,
          createdAt: true,
          createdByRun: { select: { name: true } },
        },
      },
    },
  });
  if (!artifact || artifact.versions.length === 0) {
    throw new ApiError(404, "artifact not found");
  }
  const selected =
    versionSel === "latest"
      ? artifact.versions[0]!
      : artifact.versions.find((v) => v.version === versionSel);
  if (!selected) throw new ApiError(404, "version not found");
  const files = await db.artifactFile.findMany({
    where: { versionId: selected.id },
    select: { id: true, path: true, sizeBytes: true, digest: true },
    orderBy: { path: "asc" },
  });
  return {
    id: artifact.id,
    name: artifact.name,
    type: artifact.type,
    description: artifact.description,
    project: { slug: project.slug, name: project.name },
    versions: artifact.versions.map((v) => ({
      version: v.version,
      digest: v.digest,
      sizeBytes: Number(v.sizeBytes),
      fileCount: v.fileCount,
      description: v.description,
      createdByRunId: v.createdByRunId,
      createdByRunName: v.createdByRun?.name ?? null,
      createdAt: v.createdAt,
    })),
    selected: {
      version: selected.version,
      files: files.map((f) => ({
        id: f.id,
        path: f.path,
        sizeBytes: Number(f.sizeBytes),
        digest: f.digest,
      })),
    },
  };
}

export type ArtifactDownload =
  | {
      kind: "bytes";
      path: string;
      sizeBytes: number;
      data: Uint8Array<ArrayBuffer>;
    }
  | { kind: "redirect"; url: string };

export async function downloadArtifactFile(
  auth: { orgId: string },
  fileId: string,
): Promise<ArtifactDownload> {
  const file = await db.artifactFile.findFirst({
    where: {
      id: fileId,
      version: {
        status: "COMPLETED",
        artifact: { project: { orgId: auth.orgId } },
      },
    },
    select: { path: true, sizeBytes: true, data: true, storageKey: true },
  });
  if (!file) throw new ApiError(404, "file not found");
  // S3-backed: redirect to a presigned GET (browser fetches direct).
  if (file.storageKey) {
    requireStorage();
    return { kind: "redirect", url: await presignGet(file.storageKey) };
  }
  // Legacy DB-backed rows serve inline bytes.
  if (!file.data) throw new ApiError(404, "file not found");
  // Fresh copy out of the pool-backed Buffer. The cast is honest: a new
  // allocation is always ArrayBuffer-backed (never SharedArrayBuffer),
  // which is what BlobPart requires.
  const copy = new Uint8Array(file.data.byteLength);
  copy.set(file.data);
  return {
    kind: "bytes",
    path: file.path,
    sizeBytes: Number(file.sizeBytes),
    data: copy as Uint8Array<ArrayBuffer>,
  };
}

export interface ProducedArtifact {
  versionId: string;
  artifactName: string;
  artifactType: string;
  version: number;
  digest: string;
  sizeBytes: number;
  createdAt: Date;
}

/** Versions produced by one run (run detail Overview section). */
export async function getRunArtifacts(
  auth: GroupAuth,
  runId: string,
): Promise<ProducedArtifact[]> {
  const run = await db.run.findFirst({
    where: {
      id: runId,
      project: { orgId: auth.orgId },
      ...runVisibilityFilter(auth),
    },
    select: { id: true },
  });
  if (!run) throw new ApiError(404, "run not found");
  const versions = await db.artifactVersion.findMany({
    where: { createdByRunId: runId, status: "COMPLETED" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      version: true,
      digest: true,
      sizeBytes: true,
      createdAt: true,
      artifact: { select: { name: true, type: true } },
    },
  });
  return versions.map((v) => ({
    versionId: v.id,
    artifactName: v.artifact.name,
    artifactType: v.artifact.type,
    version: v.version,
    digest: v.digest,
    sizeBytes: Number(v.sizeBytes),
    createdAt: v.createdAt,
  }));
}
