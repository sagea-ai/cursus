import type { NextRequest } from "next/server";

import { getLiveSession } from "@/lib/api-auth";
import { toErrorResponse } from "@/lib/http";
import { deleteGroup, getGroup, updateGroup } from "@/lib/groups";
import { updateGroupSchema } from "@/lib/validation";

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
): Promise<Response> {
  try {
    const { slug } = await ctx.params;
    const session = await getLiveSession(request);
    return Response.json({ group: await getGroup(session, slug) });
  } catch (e) {
    return toErrorResponse(e);
  }
}

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
): Promise<Response> {
  try {
    const { slug } = await ctx.params;
    const session = await getLiveSession(request);
    const body = updateGroupSchema.parse(await request.json());
    return Response.json({ group: await updateGroup(session, slug, body) });
  } catch (e) {
    return toErrorResponse(e);
  }
}

export async function DELETE(
  request: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
): Promise<Response> {
  try {
    const { slug } = await ctx.params;
    const session = await getLiveSession(request);
    return Response.json(await deleteGroup(session, slug));
  } catch (e) {
    return toErrorResponse(e);
  }
}
