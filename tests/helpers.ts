import { NextRequest } from "next/server";

import type { Session } from "@/lib/auth";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { SESSION_COOKIE, signSession } from "@/lib/session";

// API-route test helpers (PRD §10.2: every route tested for success AND
// authorization-failure paths).
//
// These hit the database from DATABASE_URL, so they only run when
// RUN_API_TESTS=1 (CI's throwaway postgres, or a local docker DB — never a
// shared/dev database). Each test builds an isolated org named test-<rand>
// and deletes it afterwards (Org delete cascades to users/keys/projects/
// runs/metrics).

export const apiTestsEnabled = process.env["RUN_API_TESTS"] === "1";

if (!process.env["SESSION_SECRET"]) {
  process.env["SESSION_SECRET"] = "test-secret-for-api-tests-only";
}

// The bootstrap email gate must be deterministic in-suite: tests set a
// placeholder unless the environment provides the real one (E2E/CI do).
if (!process.env["BOOTSTRAP_ADMIN_EMAIL"]) {
  process.env["BOOTSTRAP_ADMIN_EMAIL"] = "bootstrap-owner@cursus.test";
}

export function testEmail(tag: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${tag}-${rand}@cursus.test`;
}

export interface TestOrg {
  orgId: string;
  orgSlug: string;
  admin: Session;
  member: Session;
  cleanup: () => Promise<void>;
}

export async function createTestOrg(tag: string): Promise<TestOrg> {
  const rand = Math.random().toString(36).slice(2, 8);
  const org = await db.org.create({
    data: { name: `test-${tag}-${rand}`, slug: `test-${tag}-${rand}` },
  });
  const pw = await hashPassword("test-password-1");
  const adminRow = await db.user.create({
    data: {
      orgId: org.id,
      email: testEmail(`admin-${tag}`),
      passwordHash: pw,
      role: "SUPER_ADMIN",
    },
  });
  const memberRow = await db.user.create({
    data: {
      orgId: org.id,
      email: testEmail(`member-${tag}`),
      passwordHash: pw,
      role: "MEMBER",
    },
  });
  return {
    orgId: org.id,
    orgSlug: org.slug,
    admin: {
      userId: adminRow.id,
      orgId: org.id,
      email: adminRow.email,
      role: "SUPER_ADMIN",
    },
    member: {
      userId: memberRow.id,
      orgId: org.id,
      email: memberRow.email,
      role: "MEMBER",
    },
    cleanup: async () => {
      // Runs reference their creator with a Restrict FK (attribution must
      // never cascade away), so delete runs before the org cascade.
      await db.run.deleteMany({ where: { project: { orgId: org.id } } });
      await db.org.delete({ where: { id: org.id } });
    },
  };
}

/** Build a NextRequest with an optional JSON body and/or API key. */
export function apiRequest(
  path: string,
  opts: {
    method?: string;
    body?: unknown;
    apiKey?: string;
  } = {},
): NextRequest {
  const headers = new Headers();
  if (opts.body !== undefined) headers.set("content-type", "application/json");
  if (opts.apiKey) headers.set("authorization", `Bearer ${opts.apiKey}`);
  return new NextRequest(`http://test.local${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

/** Same as apiRequest but with the session baked in as a signed cookie. */
export async function authedRequest(
  path: string,
  session: Session,
  opts: { method?: string; body?: unknown } = {},
): Promise<NextRequest> {
  const token = await signSession(session);
  const req = apiRequest(path, opts);
  req.cookies.set(SESSION_COOKIE, token);
  return req;
}
