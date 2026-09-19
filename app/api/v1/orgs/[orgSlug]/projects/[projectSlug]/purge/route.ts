import { z } from "zod";
import type { NextRequest } from "next/server";

import { getLiveSession } from "@/lib/api-auth";
import { toErrorResponse } from "@/lib/http";
import { purgeProjectMetrics } from "@/lib/retention";

const schema = z.object({ dryRun: z.boolean().optional().default(false) });

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ orgSlug: string; projectSlug: string }> },
): Promise<Response> {
  try {
    const { orgSlug, projectSlug } = await ctx.params;
    const session = await getLiveSession(request);
    const body = schema.parse(await request.json());
    return Response.json(
      await purgeProjectMetrics(session, orgSlug, projectSlug, body.dryRun),
    );
  } catch (e) {
    return toErrorResponse(e);
  }
}
