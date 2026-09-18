import type { NextRequest } from "next/server";

import { authenticateRequest, getLiveSession } from "@/lib/api-auth";
import { toErrorResponse } from "@/lib/http";
import {
  deleteProject,
  getProjectOverview,
  renameProject,
} from "@/lib/projects";
import { renameProjectSchema } from "@/lib/validation";

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ orgSlug: string; projectSlug: string }> },
): Promise<Response> {
  try {
    const { orgSlug, projectSlug } = await ctx.params;
    const auth = await authenticateRequest(request);
    return Response.json(
      await getProjectOverview(auth, orgSlug, projectSlug),
    );
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
    const body = renameProjectSchema.parse(await request.json());
    return Response.json({
      project: await renameProject(session, orgSlug, projectSlug, body.name),
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
