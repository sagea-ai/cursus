import type { NextRequest } from "next/server";

import { authenticateRequest } from "@/lib/api-auth";
import { toErrorResponse } from "@/lib/http";
import { deleteWebhook } from "@/lib/webhooks";

export async function DELETE(
  request: NextRequest,
  ctx: { params: Promise<{ project: string; webhookId: string }> },
): Promise<Response> {
  try {
    const { project, webhookId } = await ctx.params;
    const auth = await authenticateRequest(request);
    return Response.json(await deleteWebhook(auth, project, webhookId));
  } catch (e) {
    return toErrorResponse(e);
  }
}
