import { createHmac, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { requireRole, type Session } from "@/lib/auth";
import { db } from "@/lib/db";
import { canWriteGroup, projectVisibilityFilter } from "@/lib/groups";
import { ApiError } from "@/lib/http";
import type { CreateWebhookInput } from "@/lib/validation";

// Project-level run-state webhooks. Signed POSTs (HMAC-SHA256) to
// user URLs — no native integrations in v1. Dispatch is fire-and-settle
// from the finish path: bounded timeout, failures swallowed, finishing a
// run never fails because a webhook is down.

export const WEBHOOK_EVENTS = ["run.finished", "run.crashed"] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];
export const WEBHOOK_MAX_PER_PROJECT = 10;
const DISPATCH_TIMEOUT_MS = 5000;

export interface WebhookRow {
  id: string;
  url: string;
  events: string[];
  createdBy: string;
  createdAt: Date;
}

/** Project must exist AND be visible (hidden slugs 404, no oracle).
 * Writable = org-wide (every member) or group the caller can write. */
async function assertProjectWritable(
  auth: Session,
  projectSlug: string,
): Promise<{ id: string }> {
  const project = await db.project.findFirst({
    where: {
      orgId: auth.orgId,
      slug: projectSlug,
      ...projectVisibilityFilter(auth),
    },
    select: { id: true, groupId: true },
  });
  if (!project) throw new ApiError(404, "project not found");
  if (project.groupId && !(await canWriteGroup(auth, project.groupId))) {
    throw new ApiError(403, "not a member of this project's group");
  }
  return project;
}

async function assertProjectVisible(
  auth: Session,
  projectSlug: string,
): Promise<{ id: string }> {
  const project = await db.project.findFirst({
    where: {
      orgId: auth.orgId,
      slug: projectSlug,
      ...projectVisibilityFilter(auth),
    },
    select: { id: true },
  });
  if (!project) throw new ApiError(404, "project not found");
  return project;
}

function toRow(w: {
  id: string;
  url: string;
  events: string[];
  createdBy: { email: string };
  createdAt: Date;
}): WebhookRow {
  return {
    id: w.id,
    url: w.url,
    events: w.events,
    createdBy: w.createdBy.email,
    createdAt: w.createdAt,
  };
}

export async function listWebhooks(
  session: Session | null,
  projectSlug: string,
): Promise<WebhookRow[]> {
  requireRole(session, "MEMBER");
  const project = await assertProjectVisible(session, projectSlug);
  const rows = await db.webhook.findMany({
    where: { projectId: project.id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      url: true,
      events: true,
      createdBy: { select: { email: true } },
      createdAt: true,
    },
  });
  return rows.map(toRow);
}

export async function createWebhook(
  session: Session | null,
  projectSlug: string,
  input: CreateWebhookInput,
): Promise<{ webhook: WebhookRow; secret: string }> {
  requireRole(session, "MEMBER");
  const project = await assertProjectWritable(session, projectSlug);
  const count = await db.webhook.count({ where: { projectId: project.id } });
  if (count >= WEBHOOK_MAX_PER_PROJECT) {
    throw new ApiError(409, "project already has 10 webhooks");
  }
  await assertSafeUrl(input.url);
  const secret = randomBytes(32).toString("hex");
  const created = await db.webhook.create({
    data: {
      projectId: project.id,
      url: input.url,
      events: input.events,
      secret,
      createdById: session.userId,
    },
    select: {
      id: true,
      url: true,
      events: true,
      createdBy: { select: { email: true } },
      createdAt: true,
    },
  });
  // Secret shown once — never returned by list/get again.
  return { webhook: toRow(created), secret };
}

export async function deleteWebhook(
  session: Session | null,
  projectSlug: string,
  webhookId: string,
): Promise<{ id: string }> {
  requireRole(session, "MEMBER");
  const project = await assertProjectWritable(session, projectSlug);
  const row = await db.webhook.findFirst({
    where: { id: webhookId, projectId: project.id },
    select: { id: true },
  });
  if (!row) throw new ApiError(404, "webhook not found");
  await db.webhook.delete({ where: { id: row.id } });
  return { id: row.id };
}

function signPayload(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

/** SSRF guard: http(s) only, no loopback/link-local/private targets —
 * checked on the literal host AND on every resolved address. */
export async function assertSafeUrl(raw: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ApiError(400, "webhook URL is not a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ApiError(400, "webhook URL must be http(s)");
  }
  if (url.username || url.password) {
    throw new ApiError(400, "webhook URL must not embed credentials");
  }
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    isBlockedIp(host)
  ) {
    throw new ApiError(400, "webhook URL target is not allowed");
  }
  // DNS-rebinding guard: every resolved address must be public too.
  let addresses: string[];
  try {
    addresses = (await lookup(host, { all: true })).map((a) => a.address);
  } catch {
    throw new ApiError(400, "webhook host does not resolve");
  }
  if (addresses.length === 0 || addresses.some(isBlockedIp)) {
    throw new ApiError(400, "webhook URL target is not allowed");
  }
}

function isBlockedIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 127 || // loopback
      a === 10 || // RFC1918
      (a === 172 && b! >= 16 && b! <= 31) || // RFC1918
      (a === 192 && b === 168) || // RFC1918
      (a === 169 && b === 254) || // link-local (cloud metadata!)
      a === 0 || // unspecified
      a >= 224 // multicast/reserved
    );
  }
  if (family === 6) {
    const h = ip.toLowerCase();
    return (
      h === "::1" ||
      h === "::" ||
      h.startsWith("fc") ||
      h.startsWith("fd") || // unique-local
      h.startsWith("fe80") // link-local
    );
  }
  return false;
}

export interface WebhookPayload {
  event: WebhookEvent;
  run_id: string;
  project: string;
  status: string;
  finished_at: string;
}

/** Fire-and-settle dispatch from the finish path. Parallel across the set
 * (capped at 10 hooks, 5 s timeout each). Never throws: a down webhook
 * must not fail the finish that triggered it. */
export async function dispatchWebhooks(
  projectId: string,
  event: WebhookEvent,
  payload: Omit<WebhookPayload, "event">,
): Promise<void> {
  const hooks = await db.webhook.findMany({
    where: { projectId, events: { has: event } },
    select: { url: true, secret: true },
  });
  await Promise.allSettled(
    hooks.map(async (hook) => {
      const body = JSON.stringify({ event, ...payload });
      const res = await fetch(hook.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Cursus-Event": event,
          "X-Cursus-Signature": signPayload(hook.secret, body),
        },
        body,
        signal: AbortSignal.timeout(DISPATCH_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`webhook answered ${res.status}`);
      await res.arrayBuffer().catch(() => undefined);
    }),
  );
}

/** Called from finishRun after the status commits. One project lookup,
 * then dispatch settles on its own — failures never propagate. */
export async function notifyRunFinished(
  runId: string,
  status: string,
  finishedAt: Date,
): Promise<void> {
  const event: WebhookEvent =
    status === "CRASHED" ? "run.crashed" : "run.finished";
  try {
    const run = await db.run.findUnique({
      where: { id: runId },
      select: {
        id: true,
        projectId: true,
        project: { select: { slug: true } },
      },
    });
    if (!run) return;
    await dispatchWebhooks(run.projectId, event, {
      run_id: run.id,
      project: run.project.slug,
      status,
      finished_at: finishedAt.toISOString(),
    });
  } catch {
    // Belt and suspenders — dispatch settles internally already.
  }
}
