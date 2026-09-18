import type { NextRequest } from "next/server";

import { getLiveSession } from "@/lib/api-auth";
import { toErrorResponse } from "@/lib/http";
import { createGroup, listGroups } from "@/lib/groups";
import { createGroupSchema } from "@/lib/validation";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const session = await getLiveSession(request);
    return Response.json({ groups: await listGroups(session) });
  } catch (e) {
    return toErrorResponse(e);
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const session = await getLiveSession(request);
    const body = createGroupSchema.parse(await request.json());
    return Response.json(
      { group: await createGroup(session, body) },
      { status: 201 },
    );
  } catch (e) {
    return toErrorResponse(e);
  }
}
