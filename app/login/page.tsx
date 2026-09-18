import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { LoginForm } from "@/components/login-form";
import { db } from "@/lib/db";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";
import { isOnboardingOpen } from "@/lib/settings";

// Fresh deployment → onboarding (login can never succeed with zero users).
// Logged-in users skip straight to their projects.
export default async function LoginPage() {
  if (await isOnboardingOpen()) redirect("/onboarding");
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
  return <LoginForm />;
}
