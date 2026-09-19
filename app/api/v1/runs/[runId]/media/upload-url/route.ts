import type { NextRequest } from "next/server";

import { authenticateRequest } from "@/lib/api-auth";
import { toErrorResponse } from "@/lib/http";
import { requestMediaUpload } from "@/lib/media";
import { requestMediaSchema } from "@/lib/validation";

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ runId: string }> },
): Promise<Response> {
  try {
    const { runId } = await ctx.params;
    const auth = await authenticateRequest(request);
    const body = requestMediaSchema.parse(await request.json());
    // 201 with the PUT ticket: the SDK uploads bytes direct to storage.
    return Response.json(await requestMediaUpload(auth, runId, body), {
      status: 201,
    });
  } catch (e) {
    return toErrorResponse(e);
  }
}
