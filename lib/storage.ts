import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Object storage for large bytes (media, future exports): S3-compatible API
// only — MinIO in compose for self-host, or bring your own (AWS S3, R2, GCS
// XML API) via env creds. Bytes NEVER proxy through Next.js: the server
// mints short-lived presigned URLs and clients PUT/GET direct to storage.
// Postgres keeps metadata + small relational rows only (scale split).
//
// Required env: S3_ENDPOINT + S3_ACCESS_KEY + S3_SECRET_KEY.
// Optional: S3_BUCKET (default cursus-media), S3_REGION (default us-east-1),
// S3_FORCE_PATH_STYLE (default true — required for MinIO).
// Without endpoint/creds, storageEnabled() is false and byte routes answer
// 503 with a clear message instead of failing obscurely mid-upload.

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function storageEnabled(): boolean {
  return Boolean(
    env("S3_ENDPOINT") && env("S3_ACCESS_KEY") && env("S3_SECRET_KEY"),
  );
}

export function storageBucket(): string {
  return env("S3_BUCKET") ?? "cursus-media";
}

let client: S3Client | null = null;
let bucketReady: Promise<void> | null = null;

export function storageClient(): S3Client {
  if (!client) {
    const endpoint = env("S3_ENDPOINT");
    const accessKeyId = env("S3_ACCESS_KEY");
    const secretAccessKey = env("S3_SECRET_KEY");
    if (!endpoint || !accessKeyId || !secretAccessKey) {
      throw new Error(
        "object storage is not configured (S3_ENDPOINT/S3_ACCESS_KEY/S3_SECRET_KEY)",
      );
    }
    client = new S3Client({
      endpoint,
      region: env("S3_REGION") ?? "us-east-1",
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: (env("S3_FORCE_PATH_STYLE") ?? "true") !== "false",
    });
  }
  return client;
}

/** Self-provisioning bucket: HeadBucket, CreateBucket on NotFound, once per
 * process. Compose needs no init container; external S3 just works. Retries
 * startup races (MinIO still booting) with backoff — throws only when
 * storage is genuinely unreachable. */
export function ensureBucket(): Promise<void> {
  if (!bucketReady) {
    bucketReady = (async () => {
      const Bucket = storageBucket();
      let lastError: unknown = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        if (attempt > 0) {
          await new Promise((r) => setTimeout(r, 500 * attempt));
        }
        try {
          await storageClient().send(new HeadBucketCommand({ Bucket }));
          return;
        } catch (e) {
          lastError = e;
          const status =
            typeof e === "object" && e !== null && "$metadata" in e
              ? (e as { $metadata?: { httpStatusCode?: number } }).$metadata
                  ?.httpStatusCode
              : undefined;
          if (status === 404) {
            await storageClient().send(new CreateBucketCommand({ Bucket }));
            return;
          }
          // Anything else (connection refused during boot, 403, …) retries.
        }
      }
      throw lastError;
    })();
  }
  return bucketReady;
}

/** Deterministic key: re-logging (run,key,step) overwrites the same object,
 * so storage can never leak orphan versions of it. */
export function mediaStorageKey(
  orgId: string,
  runId: string,
  key: string,
  step: number,
  ext: string,
): string {
  const slug = key
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return `media/${orgId}/${runId}/${slug || "k"}/${step}.${ext}`;
}

export async function presignPut(
  storageKey: string,
  mime: string,
  expiresIn = 900,
): Promise<string> {
  await ensureBucket();
  return getSignedUrl(
    storageClient(),
    new PutObjectCommand({
      Bucket: storageBucket(),
      Key: storageKey,
      ContentType: mime,
    }),
    { expiresIn },
  );
}

export async function presignGet(
  storageKey: string,
  expiresIn = 900,
): Promise<string> {
  await ensureBucket();
  return getSignedUrl(
    storageClient(),
    new GetObjectCommand({ Bucket: storageBucket(), Key: storageKey }),
    { expiresIn },
  );
}

/** Null when the object isn't there (upload never finished / deleted). */
export async function headObject(
  storageKey: string,
): Promise<{ size: number } | null> {
  try {
    const out = await storageClient().send(
      new HeadObjectCommand({ Bucket: storageBucket(), Key: storageKey }),
    );
    return { size: Number(out.ContentLength ?? 0) };
  } catch {
    return null;
  }
}

/** Chunked at the S3 1000-key DeleteObjects limit. Best-effort per chunk
 * (purge paths must not fail on one bad key); returns deleted count. */
export async function deleteObjects(storageKeys: string[]): Promise<number> {
  let deleted = 0;
  for (let i = 0; i < storageKeys.length; i += 1000) {
    const chunk = storageKeys.slice(i, i + 1000);
    try {
      const out = await storageClient().send(
        new DeleteObjectsCommand({
          Bucket: storageBucket(),
          Delete: { Objects: chunk.map((Key) => ({ Key })) },
        }),
      );
      deleted += out.Deleted?.length ?? 0;
    } catch {
      // Swallow per-chunk failures — callers treat storage as best-effort
      // cleanup alongside authoritative DB deletes.
    }
  }
  return deleted;
}
