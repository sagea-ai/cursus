import { redirect } from "next/navigation";

import { OnboardingStatusCard } from "@/components/onboarding-status-card";
import { requirePageSession } from "@/lib/page-auth";
import { getOnboardingSettings } from "@/lib/settings";

// Super-admin-only workspace settings. Members never see the nav item;
// direct access redirects them to their projects.
export default async function SettingsPage({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  const { org: orgSlug } = await params;
  const { session, org } = await requirePageSession(orgSlug);
  if (session.role !== "SUPER_ADMIN") {
    redirect(`/${org.slug}/projects`);
  }
  const settings = await getOnboardingSettings(session);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-8">
      <div>
        <p className="text-xs text-muted-foreground">{org.name}</p>
        <h1 className="text-2xl font-semibold">Settings</h1>
      </div>
      <OnboardingStatusCard initialDisabled={settings.disabled} />
    </main>
  );
}
