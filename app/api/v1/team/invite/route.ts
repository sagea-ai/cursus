import type { NextRequest } from "next/server";

import { toErrorResponse } from "@/lib/http";
import { getLiveSession } from "@/lib/api-auth";
import { inviteMember } from "@/lib/team";
import { inviteMemberSchema } from "@/lib/validation";

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const session = await getLiveSession(request);
    const body = inviteMemberSchema.parse(await request.json());
    const { user, inviteUrl } = await inviteMember(
      session,
      body.email,
      body.role,
    );
    return Response.json({ user, inviteUrl }, { status: 201 });
  } catch (e) {
    return toErrorResponse(e);
  }
}
