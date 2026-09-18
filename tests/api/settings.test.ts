import { describe, expect, it } from "vitest";

import {
  GET as settingsGET,
  PATCH as settingsPATCH,
} from "@/app/api/v1/settings/onboarding/route";
import { POST as bootstrapPOST } from "@/app/api/v1/auth/bootstrap/route";
import { db } from "@/lib/db";
import { isOnboardingOpen } from "@/lib/settings";
import {
  apiRequest,
  apiTestsEnabled,
  authedRequest,
  createTestOrg,
  testEmail,
} from "../helpers";

describe.skipIf(!apiTestsEnabled)("onboarding settings", () => {
  it("isOnboardingOpen is false once any user exists", async () => {
    // The true case (empty DB) cannot run in this shared suite — it is
    // covered by the E2E journey, which loads /onboarding on a fresh DB.
    const org = await createTestOrg("settings");
    try {
      expect(await isOnboardingOpen()).toBe(false);
    } finally {
      await org.cleanup();
    }
  });

  it("admin reads status; member → 403; anon → 401", async () => {
    const org = await createTestOrg("settings");
    try {
      const res = await settingsGET(
        await authedRequest("/api/v1/settings/onboarding", org.admin),
      );
      expect(res.status).toBe(200);
      expect(
        typeof ((await res.json()) as { disabled: unknown }).disabled,
      ).toBe("boolean");

      const member = await settingsGET(
        await authedRequest("/api/v1/settings/onboarding", org.member),
      );
      expect(member.status).toBe(403);

      const anon = await settingsGET(apiRequest("/api/v1/settings/onboarding"));
      expect(anon.status).toBe(401);
    } finally {
      await org.cleanup();
    }
  });

  it("disable is one-way: true sticks, false → 409", async () => {
    const org = await createTestOrg("settings");
    try {
      const off = await settingsPATCH(
        await authedRequest("/api/v1/settings/onboarding", org.admin, {
          method: "PATCH",
          body: { disabled: true },
        }),
      );
      expect(off.status).toBe(200);
      expect((await off.json()).disabled).toBe(true);

      const backOn = await settingsPATCH(
        await authedRequest("/api/v1/settings/onboarding", org.admin, {
          method: "PATCH",
          body: { disabled: false },
        }),
      );
      expect(backOn.status).toBe(409);

      const member = await settingsPATCH(
        await authedRequest("/api/v1/settings/onboarding", org.member, {
          method: "PATCH",
          body: { disabled: true },
        }),
      );
      expect(member.status).toBe(403);
    } finally {
      await org.cleanup();
    }
  });

  it("disabled flag closes bootstrap with 410 before any other check", async () => {
    // The flag is deployment-global; the API suite runs files serially
    // (singleFork) exactly so this flip cannot disturb parallel tests.
    const org = await createTestOrg("settings");
    try {
      await db.globalSettings.upsert({
        where: { id: "global" },
        update: { onboardingDisabled: true },
        create: { id: "global", onboardingDisabled: true },
      });
      const res = await bootstrapPOST(
        apiRequest("/api/v1/auth/bootstrap", {
          method: "POST",
          body: {
            orgName: "another",
            name: "Owner",
            email: testEmail("owner"),
            password: "password-1",
          },
        }),
      );
      expect(res.status).toBe(410);
    } finally {
      await db.globalSettings.upsert({
        where: { id: "global" },
        update: { onboardingDisabled: false },
        create: { id: "global", onboardingDisabled: false },
      });
      await org.cleanup();
    }
  });
});
