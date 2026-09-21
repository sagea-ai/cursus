import { requireAuth, requireRole, type Session } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertRunWritable, runVisibilityFilter } from "@/lib/groups";
import { ApiError } from "@/lib/http";
import {
  deleteObjects,
  headObject,
  mediaStorageKey,
  presignGet,
  presignPut,
  storageEnabled,
} from "@/lib/storage";
import type { RequestMediaInput } from "@/lib/validation";

// Image media over object storage. Two-phase upload keeps storage
// leak-free: PENDING rows hold no bytes until the client PUTs + confirms,
// re-logs overwrite the same deterministic object, and stale PENDING rows
// are swept lazily per run. The viewer only ever lists COMPLETED items.

export const MEDIA_MIME_ALLOW = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
} as const;

export const MEDIA_MAX_BYTES = 5 * 1024 * 1024;
export const MEDIA_MAX_PER_RUN = 500;
export const MEDIA_LIST_CAP = 500;

function requireStorage(): void {
  if (!storageEnabled()) {
    throw new ApiError(
      503,
      "media requires object storage (S3_ENDPOINT/S3_ACCESS_KEY/S3_SECRET_KEY)",
    );
  }
}

async function runOrg(
  auth: { orgId: string; userId: string; role: Session["role"] },
  runId: string,
): Promise<{ id: string; orgId: string }> {
  const writable = await assertRunWritable(auth, runId);
  const run = await db.run.findUnique({
    where: { id: writable.id },
    select: { id: true, project: { select: { orgId: true } } },
  });
  if (!run) throw new ApiError(404, "run not found");
  return { id: run.id, orgId: run.project.orgId };
}

export interface UploadTicket {
  mediaId: string;
  url: string;
  method: "PUT";
  headers: { "Content-Type": string };
  expiresIn: number;
}

export async function requestMediaUpload(
  auth: Session | null,
  runId: string,
  input: RequestMediaInput,
): Promise<UploadTicket> {
  requireRole(auth, "MEMBER");
  requireStorage();
  const run = await runOrg(auth, runId);
  const mime = input.mime as keyof typeof MEDIA_MIME_ALLOW;
  const ext = MEDIA_MIME_ALLOW[mime];
  if (!ext) throw new ApiError(400, "unsupported image type");
  if (input.sizeBytes < 1 || input.sizeBytes > MEDIA_MAX_BYTES) {
    throw new ApiError(413, "image exceeds the 5 MB per-item cap");
  }
  const existing = await db.mediaItem.count({
    where: { runId: run.id, status: "COMPLETED" },
  });
  if (existing >= MEDIA_MAX_PER_RUN) {
    throw new ApiError(413, "run already holds 500 images");
  }
  const storageKey = mediaStorageKey(
    run.orgId,
    run.id,
    input.key,
    input.step,
    ext,
  );
  // Same deterministic key every time: a re-log overwrites the object, and
  // the row upsert below collapses to one row — no orphan objects ever.
  const item = await db.mediaItem.upsert({
    where: {
      runId_key_step: { runId: run.id, key: input.key, step: input.step },
    },
    create: {
      runId: run.id,
      key: input.key,
      step: input.step,
      mime: input.mime,
      sizeBytes: input.sizeBytes,
      storageKey,
      status: "PENDING",
    },
    update: {
      mime: input.mime,
      sizeBytes: input.sizeBytes,
      storageKey,
      status: "PENDING",
    },
    select: { id: true },
  });
  // Lazy orphan sweep: PENDING rows whose PUT never arrived (bounded to
  // this run, one query, no storage to clean — nothing was uploaded).
  await db.mediaItem.deleteMany({
    where: {
      runId: run.id,
      status: "PENDING",
      id: { not: item.id },
      createdAt: { lt: new Date(Date.now() - 24 * 3600_000) },
    },
  });
  const expiresIn = 900;
  return {
    mediaId: item.id,
    url: await presignPut(storageKey, input.mime, expiresIn),
    method: "PUT",
    headers: { "Content-Type": input.mime },
    expiresIn,
  };
}

export async function completeMediaUpload(
  auth: Session | null,
  runId: string,
  mediaId: string,
): Promise<{ id: string; key: string; step: number }> {
  requireRole(auth, "MEMBER");
  requireStorage();
  const run = await runOrg(auth, runId);
  const item = await db.mediaItem.findFirst({
    where: { id: mediaId, runId: run.id },
  });
  if (!item) throw new ApiError(404, "media not found");
  if (item.status === "COMPLETED") {
    return { id: item.id, key: item.key, step: item.step };
  }
  const head = await headObject(item.storageKey);
  if (!head) {
    throw new ApiError(
      409,
      "bytes not uploaded yet — PUT to the ticket URL first",
    );
  }
  await db.mediaItem.update({
    where: { id: item.id },
    data: { status: "COMPLETED", sizeBytes: head.size },
  });
  return { id: item.id, key: item.key, step: item.step };
}

export interface MediaStep {
  id: string;
  step: number;
  mime: string;
  url: string;
}

/** Viewer list: COMPLETED steps for one key, presigned GETs (15 min).
 * Read-gated by run visibility (same rule as metrics). */
async function assertRunVisible(
  auth: Session,
  runId: string,
): Promise<{ id: string }> {
  const run = await db.run.findFirst({
    where: {
      id: runId,
      project: { orgId: auth.orgId },
      ...runVisibilityFilter(auth),
    },
    select: { id: true },
  });
  if (!run) throw new ApiError(404, "run not found");
  return run;
}

async function listMediaSteps(
  runId: string,
  key: string,
): Promise<MediaStep[]> {
  const items = await db.mediaItem.findMany({
    where: { runId, key, status: "COMPLETED" },
    orderBy: { step: "asc" },
    take: MEDIA_LIST_CAP,
    select: { id: true, step: true, mime: true, storageKey: true },
  });
  return Promise.all(
    items.map(async (item) => ({
      id: item.id,
      step: item.step,
      mime: item.mime,
      url: await presignGet(item.storageKey),
    })),
  );
}

export async function listMedia(
  auth: Session | null,
  runId: string,
  key: string,
): Promise<MediaStep[]> {
  requireAuth(auth);
  requireStorage();
  const run = await assertRunVisible(auth, runId);
  return listMediaSteps(run.id, key);
}

/** Distinct media keys for the run (viewer tabs). One indexed groupBy. */
export async function listMediaKeys(
  auth: Session | null,
  runId: string,
): Promise<string[]> {
  requireAuth(auth);
  const run = await db.run.findFirst({
    where: {
      id: runId,
      project: { orgId: auth.orgId },
      ...runVisibilityFilter(auth),
    },
    select: { id: true },
  });
  if (!run) throw new ApiError(404, "run not found");
  const rows = await db.mediaItem.groupBy({
    by: ["key"],
    where: { runId: run.id, status: "COMPLETED" },
    orderBy: { key: "asc" },
    take: 24,
  });
  return rows.map((row) => row.key);
}

export interface MediaKeyView {
  key: string;
  steps: MediaStep[];
}

/** Everything the run-detail viewer needs: keys + presigned step URLs.
 * ONE run gate, then 1 groupBy + 1 steps query per key (keys capped at
 * 24) — the old shape re-gated the same run per key. Presigning is local
 * crypto, parallelized. URLs live 15 minutes — a stale page refreshes
 * them on reload. */
export async function getRunMediaView(
  auth: Session | null,
  runId: string,
): Promise<MediaKeyView[]> {
  requireAuth(auth);
  requireStorage();
  const run = await assertRunVisible(auth, runId);
  const rows = await db.mediaItem.groupBy({
    by: ["key"],
    where: { runId: run.id, status: "COMPLETED" },
    orderBy: { key: "asc" },
    take: 24,
  });
  return Promise.all(
    rows.map(async (row) => ({
      key: row.key,
      steps: await listMediaSteps(run.id, row.key),
    })),
  );
}

/** Purge every object for a run (run deletion already cascades the rows;
 * callers use this when rows vanish by other paths). */
export async function purgeRunMedia(runId: string): Promise<number> {
  const rows = await db.mediaItem.findMany({
    where: { runId },
    select: { storageKey: true },
  });
  if (rows.length === 0) return 0;
  return deleteObjects(rows.map((row) => row.storageKey));
}
