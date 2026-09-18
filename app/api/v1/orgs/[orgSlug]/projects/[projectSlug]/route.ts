import type { NextRequest } from "next/server";

import { authenticateRequest, getLiveSession } from "@/lib/api-auth";
import { toErrorResponse } from "@/lib/http";
import {
  deleteProject,
  getProjectOverview,
  updateProject,
} from "@/lib/projects";
import { updateProjectSchema } from "@/lib/validation";

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ orgSlug: string; projectSlug: string }> },
): Promise<Response> {
  try {
    const { orgSlug, projectSlug } = await ctx.params;
    const auth = await authenticateRequest(request);
    return Response.json(await getProjectOverview(auth, orgSlug, projectSlug));
  } catch (e) {
    return toErrorResponse(e);
  }
}

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ orgSlug: string; projectSlug: string }> },
): Promise<Response> {
  try {
    const { orgSlug, projectSlug } = await ctx.params;
    const session = await getLiveSession(request);
    const body = updateProjectSchema.parse(await request.json());
    return Response.json({
      project: await updateProject(session, orgSlug, projectSlug, body),
    });
  } catch (e) {
    return toErrorResponse(e);
  }
}

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
