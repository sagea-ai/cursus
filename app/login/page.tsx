import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { LoginForm } from "@/components/login-form";
import { db } from "@/lib/db";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

// Logged-in users skip straight to their projects.
export default async function LoginPage() {
  const jar = await cookies();
  const claimed = await verifySessionToken(
    jar.get(SESSION_COOKIE)?.value ?? "",
  );
  if (claimed) {
    const user = await db.user.findUnique({
      where: { id: claimed.userId },
      include: { org: { select: { slug: true } } },
    });
    if (user) redirect(`/${user.org.slug}/projects`);
  }
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <LoginForm />
    </main>
  );
}
