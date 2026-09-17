import type { NextRequest } from "next/server";

import { toErrorResponse } from "@/lib/http";
import { createKey, listKeys } from "@/lib/keys";
import { getLiveSession } from "@/lib/api-auth";
import { createKeySchema } from "@/lib/validation";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const session = await getLiveSession(request);
    return Response.json({ keys: await listKeys(session) });
  } catch (e) {
    return toErrorResponse(e);
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const session = await getLiveSession(request);
    const body = createKeySchema.parse(await request.json());
    const { key, plaintext } = await createKey(session, body.label);
    // plaintext is shown exactly once — never stored, never re-readable.
    return Response.json({ key, plaintext }, { status: 201 });
  } catch (e) {
    return toErrorResponse(e);
  }
}
