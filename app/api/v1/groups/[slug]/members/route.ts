import type { NextRequest } from "next/server";

import { getLiveSession } from "@/lib/api-auth";
import { toErrorResponse } from "@/lib/http";
import { addGroupMember } from "@/lib/groups";
import { addGroupMemberSchema } from "@/lib/validation";

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
): Promise<Response> {
  try {
    const { slug } = await ctx.params;
    const session = await getLiveSession(request);
    const body = addGroupMemberSchema.parse(await request.json());
    return Response.json(
      { member: await addGroupMember(session, slug, body.email) },
      { status: 201 },
    );
  } catch (e) {
    return toErrorResponse(e);
  }
}
