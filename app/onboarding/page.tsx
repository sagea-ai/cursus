import { redirect } from "next/navigation";

import { OnboardingForm } from "@/components/onboarding-form";
import { isOnboardingOpen } from "@/lib/settings";

// Must render per-request: the closed/open decision depends on live DB state
// and server env. (Without this, Next statically prerenders the page at
// build time — against whatever database the build sees — and bakes that
// verdict in permanently.)
export const dynamic = "force-dynamic";

// First-run onboarding (docs/prd-onboarding.md). Closed states redirect to
// login; the expected email address is never rendered. The org-name
// suggestion comes straight from env (server-side only, safe to pass down).
export default async function OnboardingPage() {
  if (!(await isOnboardingOpen())) redirect("/login");

  const emailConfigured = Boolean(process.env["BOOTSTRAP_ADMIN_EMAIL"]?.trim());
  if (!emailConfigured) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f4f4f5] p-6 text-neutral-900">
        <div className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-xl font-bold">Onboarding is not configured</h1>
          <p className="mt-2 text-sm text-neutral-500">
            Set BOOTSTRAP_ADMIN_EMAIL on the server, then reload this page.
          </p>
        </div>
      </main>
    );
  }

  return (
    <OnboardingForm orgSuggestion={process.env["BOOTSTRAP_ORG_NAME"] ?? ""} />
  );
}
