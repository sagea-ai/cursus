import type { NextRequest } from "next/server";

import { authenticateRequest } from "@/lib/api-auth";
import { toErrorResponse } from "@/lib/http";
import { createSweep, listSweeps } from "@/lib/sweeps";
import { createSweepSchema } from "@/lib/validation";

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ project: string }> },
): Promise<Response> {
  try {
    const { project } = await ctx.params;
    const auth = await authenticateRequest(request);
    return Response.json({ sweeps: await listSweeps(auth, project) });
  } catch (e) {
    return toErrorResponse(e);
  }
}

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ project: string }> },
): Promise<Response> {
  try {
    const { project } = await ctx.params;
    const auth = await authenticateRequest(request);
    const body = createSweepSchema.parse(await request.json());
    return Response.json(await createSweep(auth, project, body), {
      status: 201,
    });
  } catch (e) {
    return toErrorResponse(e);
  }
}
