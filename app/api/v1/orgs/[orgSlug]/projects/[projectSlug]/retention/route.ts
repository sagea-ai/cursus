import { z } from "zod";
import type { NextRequest } from "next/server";

import { getLiveSession } from "@/lib/api-auth";
import { toErrorResponse } from "@/lib/http";
import { setProjectRetention } from "@/lib/retention";

const schema = z.object({
  // TTL days, or null to keep forever.
  metricsTtlDays: z.number().int().min(1).max(3650).nullable(),
});

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ orgSlug: string; projectSlug: string }> },
): Promise<Response> {
  try {
    const { orgSlug, projectSlug } = await ctx.params;
    const session = await getLiveSession(request);
    const body = schema.parse(await request.json());
    return Response.json(
      await setProjectRetention(
        session,
        orgSlug,
        projectSlug,
        body.metricsTtlDays,
      ),
    );
  } catch (e) {
    return toErrorResponse(e);
  }
}
