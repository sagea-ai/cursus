import type { NextRequest } from "next/server";

import { authenticateRequest } from "@/lib/api-auth";
import { toErrorResponse } from "@/lib/http";
import { createWebhook, listWebhooks } from "@/lib/webhooks";
import { createWebhookSchema } from "@/lib/validation";

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ project: string }> },
): Promise<Response> {
  try {
    const { project } = await ctx.params;
    const auth = await authenticateRequest(request);
    return Response.json({ webhooks: await listWebhooks(auth, project) });
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
    const body = createWebhookSchema.parse(await request.json());
    // 201: the secret is shown once, never returned again.
    return Response.json(await createWebhook(auth, project, body), {
      status: 201,
    });
  } catch (e) {
    return toErrorResponse(e);
  }
}
