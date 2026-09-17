import type { NextRequest } from "next/server";

import { authenticateRequest, getLiveSession } from "@/lib/api-auth";
import { toErrorResponse } from "@/lib/http";
import { deleteRun, getRun, updateRun } from "@/lib/runs";
import { updateRunSchema } from "@/lib/validation";

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ runId: string }> },
): Promise<Response> {
  try {
    const { runId } = await ctx.params;
    const auth = await authenticateRequest(request);
    return Response.json({ run: await getRun(auth, runId) });
  } catch (e) {
    return toErrorResponse(e);
  }
}

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ runId: string }> },
): Promise<Response> {
  try {
    const { runId } = await ctx.params;
    const auth = await authenticateRequest(request);
    const body = updateRunSchema.parse(await request.json());
    return Response.json({ run: await updateRun(auth, runId, body) });
  } catch (e) {
    return toErrorResponse(e);
  }
}

export async function DELETE(
  request: NextRequest,
  ctx: { params: Promise<{ runId: string }> },
): Promise<Response> {
  try {
    const { runId } = await ctx.params;
    const session = await getLiveSession(request);
    return Response.json(await deleteRun(session, runId));
  } catch (e) {
    return toErrorResponse(e);
  }
}
