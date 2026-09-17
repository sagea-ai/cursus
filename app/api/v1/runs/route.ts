import type { NextRequest } from "next/server";

import { authenticateRequest } from "@/lib/api-auth";
import { toErrorResponse } from "@/lib/http";
import { createRun } from "@/lib/runs";
import { createRunSchema } from "@/lib/validation";

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const auth = await authenticateRequest(request);
    const body = createRunSchema.parse(await request.json());
    const result = await createRun(auth, body);
    return Response.json(result, { status: 201 });
  } catch (e) {
    return toErrorResponse(e);
  }
}
