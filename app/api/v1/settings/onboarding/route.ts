import type { NextRequest } from "next/server";

import { getLiveSession } from "@/lib/api-auth";
import { toErrorResponse } from "@/lib/http";
import { getOnboardingSettings, setOnboardingDisabled } from "@/lib/settings";
import { onboardingSettingsSchema } from "@/lib/validation";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const session = await getLiveSession(request);
    return Response.json(await getOnboardingSettings(session));
  } catch (e) {
    return toErrorResponse(e);
  }
}

export async function PATCH(request: NextRequest): Promise<Response> {
  try {
    const session = await getLiveSession(request);
    const body = onboardingSettingsSchema.parse(await request.json());
    return Response.json(await setOnboardingDisabled(session, body.disabled));
  } catch (e) {
    return toErrorResponse(e);
  }
}
