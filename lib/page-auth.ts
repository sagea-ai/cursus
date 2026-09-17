import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import type { Session } from "@/lib/auth";
import { db } from "@/lib/db";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

// Server-side page guard: every dashboard page calls this, never trusts a
// client-side check. No session → /login. Wrong org slug → own org (a user
// belongs to exactly one org in v1) or 404 for unknown slugs.
export async function requirePageSession(orgSlug?: string): Promise<{
  session: Session;
  org: { id: string; slug: string; name: string };
}> {
  const jar = await cookies();
  const claimed = await verifySessionToken(
    jar.get(SESSION_COOKIE)?.value ?? "",
  );
  if (!claimed) redirect("/login");
  const user = await db.user.findUnique({
    where: { id: claimed.userId },
    include: { org: { select: { id: true, slug: true, name: true } } },
  });
  if (!user) redirect("/login");
  const session: Session = {
    userId: user.id,
    orgId: user.orgId,
    email: user.email,
    role: user.role,
  };
  if (orgSlug === undefined) return { session, org: user.org };
  if (orgSlug !== user.org.slug) {
    const exists = await db.org.findUnique({
      where: { slug: orgSlug },
      select: { id: true },
    });
    // Unknown slug → 404; another org's slug → back to your own org.
    if (!exists) notFound();
    redirect(`/${user.org.slug}/projects`);
  }
  return { session, org: user.org };
}
