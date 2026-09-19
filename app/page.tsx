import { redirect } from "next/navigation";

import { requirePageSession } from "@/lib/page-auth";
import { isOnboardingOpen } from "@/lib/settings";

// Landing: fresh deployment → onboarding; logged in → dashboard;
// otherwise requirePageSession sends you to /login.
export default async function Home() {
  if (await isOnboardingOpen()) redirect("/onboarding");
  const { org } = await requirePageSession();
  redirect(`/${org.slug}/dashboard`);
}
