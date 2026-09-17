import type { NextRequest } from "next/server";

import { toErrorResponse } from "@/lib/http";
import { createProject, listProjects } from "@/lib/projects";
import { getLiveSession } from "@/lib/api-auth";
import { createProjectSchema } from "@/lib/validation";

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ orgSlug: string }> },
): Promise<Response> {
  try {
    const { orgSlug } = await ctx.params;
    const session = await getLiveSession(request);
    return Response.json({
      projects: await listProjects(session, orgSlug),
    });
  } catch (e) {
    return toErrorResponse(e);
  }
}

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ orgSlug: string }> },
): Promise<Response> {
  try {
    const { orgSlug } = await ctx.params;
    const session = await getLiveSession(request);
    const body = createProjectSchema.parse(await request.json());
    const project = await createProject(session, orgSlug, body);
    return Response.json({ project }, { status: 201 });
  } catch (e) {
    return toErrorResponse(e);
  }
}
