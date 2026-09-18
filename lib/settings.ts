import { requireRole, type Session } from "@/lib/auth";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/http";

// Deployment settings surface (docs/prd-onboarding.md). The onboarding
// kill-switch is one-way: completion closes it automatically, an admin may
// close it manually, and nothing re-opens it (PATCH false → 409).

export async function getOnboardingSettings(
  session: Session | null,
): Promise<{ disabled: boolean }> {
  requireRole(session, "SUPER_ADMIN");
  const row = await db.globalSettings.upsert({
    where: { id: "global" },
    update: {},
    create: { id: "global" },
  });
  return { disabled: row.onboardingDisabled };
}

export async function setOnboardingDisabled(
  session: Session | null,
  disabled: boolean,
): Promise<{ disabled: boolean }> {
  requireRole(session, "SUPER_ADMIN");
  if (!disabled) {
    throw new ApiError(409, "onboarding cannot be re-enabled once closed");
  }
  await db.globalSettings.upsert({
    where: { id: "global" },
    update: { onboardingDisabled: true },
    create: { id: "global", onboardingDisabled: true },
  });
  return { disabled: true };
}
