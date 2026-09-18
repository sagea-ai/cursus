import type { NextRequest } from "next/server";

import { getLiveSession } from "@/lib/api-auth";
import { toErrorResponse } from "@/lib/http";
import { getProfile, updateProfile } from "@/lib/profile";
import { updateProfileSchema } from "@/lib/validation";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const session = await getLiveSession(request);
    return Response.json({ user: await getProfile(session) });
  } catch (e) {
    return toErrorResponse(e);
  }
}

export async function PATCH(request: NextRequest): Promise<Response> {
  try {
    const session = await getLiveSession(request);
    const body = updateProfileSchema.parse(await request.json());
    return Response.json({ user: await updateProfile(session, body) });
  } catch (e) {
    return toErrorResponse(e);
  }
}
