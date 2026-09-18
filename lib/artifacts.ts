import { createHash } from "node:crypto";

import { db } from "@/lib/db";
import { ApiError } from "@/lib/http";
import { slugify } from "@/lib/runs";
import type { ArtifactUploadFields } from "@/lib/validation";

// Artifacts v1: run-attached versioned files. Deliberately NOT a registry:
// no aliases, no lineage edges, no cross-project linking. Bytes live in
// Postgres (bytea) so self-hosting stays one database; the per-file cap
// below is the load-bearing constraint — an S3-compatible backend is the
// documented v2 escape hatch, not a v1 fallback.

export const MAX_ARTIFACT_FILE_BYTES = 100 * 1024 * 1024; // 100 MB
export const MAX_FILES_PER_VERSION = 1000;

export interface UploadFile {
  path: string;
  data: Uint8Array;
}

function sha256Hex(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function cleanPath(raw: string): string {
  const path = raw.trim().replace(/\\/g, "/");
  if (!path || path.startsWith("/") || path.split("/").includes("..")) {
    throw new ApiError(400, `invalid file path: ${raw}`);
  }
  return path;
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

export async function createArtifactVersion(
  auth: { orgId: string; userId: string },
  fields: ArtifactUploadFields,
  uploads: UploadFile[],
): Promise<CreatedVersion> {
  if (uploads.length === 0) throw new ApiError(400, "no files uploaded");
  if (uploads.length > MAX_FILES_PER_VERSION) {
    throw new ApiError(
      400,
      `at most ${MAX_FILES_PER_VERSION} files per version`,
    );
  }
  // Resolve the owning project: explicit slug wins, else the run's project.
  let projectId: string | null = null;
  let runId: string | null = null;
  if (fields.run_id) {
    const run = await db.run.findFirst({
      where: { id: fields.run_id, project: { orgId: auth.orgId } },
      select: { id: true, projectId: true },
    });
    if (!run) throw new ApiError(404, "run not found");
    runId = run.id;
    projectId = run.projectId;
  }
  if (fields.project) {
    const slug = slugify(fields.project);
    const project = await db.project.findUnique({
      where: { orgId_slug: { orgId: auth.orgId, slug } },
      select: { id: true },
    });
    if (!project) throw new ApiError(404, "project not found");
    if (projectId && projectId !== project.id) {
      throw new ApiError(400, "run_id and project disagree");
    }
    projectId = project.id;
  }
  if (!projectId) throw new ApiError(400, "project or run_id is required");

  const seen = new Set<string>();
  const files = uploads.map((u) => {
    const path = cleanPath(u.path);
    if (seen.has(path)) throw new ApiError(400, `duplicate path: ${path}`);
    seen.add(path);
    if (u.data.length === 0) throw new ApiError(400, `empty file: ${path}`);
    if (u.data.length > MAX_ARTIFACT_FILE_BYTES) {
      throw new ApiError(413, `file too large (max 100 MB): ${path}`);
    }
    return { path, data: Buffer.from(u.data), digest: sha256Hex(u.data) };
  });
  const digest = createHash("sha256")
    .update(
      files
        .map((f) => `${f.path}:${f.digest}`)
        .sort()
        .join("\n"),
    )
    .digest("hex");
  const sizeBytes = files.reduce(
    (n, f) => n + BigInt(f.data.length),
    BigInt(0),
  );

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
          files: {
            create: files.map((f) => ({
              path: f.path,
              sizeBytes: f.data.length,
              digest: f.digest,
              data: f.data,
            })),
          },
        },
        select: {
          version: true,
          digest: true,
          sizeBytes: true,
          fileCount: true,
          createdByRunId: true,
          files: { select: { id: true, path: true, sizeBytes: true } },
        },
      });
      return {
        artifact,
        version: {
          version: created.version,
          digest: created.digest,
          sizeBytes: Number(created.sizeBytes),
          fileCount: created.fileCount,
          createdByRunId: created.createdByRunId,
        },
        files: created.files.map((f) => ({
          id: f.id,
          path: f.path,
          sizeBytes: Number(f.sizeBytes),
        })),
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
      _count: { select: { versions: true } },
    },
  });
  if (artifacts.length === 0) return [];
  // One batched versions query, latest picked in JS — not N+1.
  const versions = await db.artifactVersion.findMany({
    where: { artifactId: { in: artifacts.map((a) => a.id) } },
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
      versionCount: a._count.versions,
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

export async function downloadArtifactFile(
  auth: { orgId: string },
  fileId: string,
): Promise<{ path: string; sizeBytes: number; data: Uint8Array<ArrayBuffer> }> {
  const file = await db.artifactFile.findFirst({
    where: {
      id: fileId,
      version: { artifact: { project: { orgId: auth.orgId } } },
    },
    select: { path: true, sizeBytes: true, data: true },
  });
  if (!file) throw new ApiError(404, "file not found");
  // Fresh copy out of the pool-backed Buffer. The cast is honest: a new
  // allocation is always ArrayBuffer-backed (never SharedArrayBuffer),
  // which is what BlobPart requires.
  const copy = new Uint8Array(file.data.byteLength);
  copy.set(file.data);
  return {
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
  auth: { orgId: string },
  runId: string,
): Promise<ProducedArtifact[]> {
  const run = await db.run.findFirst({
    where: { id: runId, project: { orgId: auth.orgId } },
    select: { id: true },
  });
  if (!run) throw new ApiError(404, "run not found");
  const versions = await db.artifactVersion.findMany({
    where: { createdByRunId: runId },
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
