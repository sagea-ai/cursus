import type { NextRequest } from "next/server";

import { getLiveSession } from "@/lib/api-auth";
import { toErrorResponse } from "@/lib/http";
import { deleteProject } from "@/lib/projects";

export async function DELETE(
  request: NextRequest,
  ctx: { params: Promise<{ orgSlug: string; projectSlug: string }> },
): Promise<Response> {
  try {
    const { orgSlug, projectSlug } = await ctx.params;
    const session = await getLiveSession(request);
    return Response.json(await deleteProject(session, orgSlug, projectSlug));
  } catch (e) {
    return toErrorResponse(e);
  }
}
