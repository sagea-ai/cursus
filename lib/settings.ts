import { requireRole, type Session } from "@/lib/auth";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/http";

// Deployment settings surface (docs/prd-onboarding.md). The onboarding
// kill-switch is one-way: completion closes it automatically, an admin may
// close it manually, and nothing re-opens it (PATCH false → 409).

/** True only on a fresh deployment: flag open AND zero users. */
export async function isOnboardingOpen(): Promise<boolean> {
  // Count first: on a live instance this returns false with a single cheap
  // read and — critically — no write. The upsert below only ever runs on an
  // empty database, so normal page hits never touch GlobalSettings.
  if ((await db.user.count()) > 0) return false;
  const settings = await db.globalSettings.upsert({
    where: { id: "global" },
    update: {},
    create: { id: "global" },
  });
  return !settings.onboardingDisabled;
}

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
