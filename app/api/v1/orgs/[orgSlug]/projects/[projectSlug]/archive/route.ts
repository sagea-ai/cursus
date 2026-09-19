import { z } from "zod";
import type { NextRequest } from "next/server";

import { getLiveSession } from "@/lib/api-auth";
import { toErrorResponse } from "@/lib/http";
import { setProjectArchived } from "@/lib/retention";

const schema = z.object({ archived: z.boolean() });

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ orgSlug: string; projectSlug: string }> },
): Promise<Response> {
  try {
    const { orgSlug, projectSlug } = await ctx.params;
    const session = await getLiveSession(request);
    const body = schema.parse(await request.json());
    return Response.json(
      await setProjectArchived(session, orgSlug, projectSlug, body.archived),
    );
  } catch (e) {
    return toErrorResponse(e);
  }
}
