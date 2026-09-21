import type { NextRequest } from "next/server";

import { authenticateRequest } from "@/lib/api-auth";
import { toErrorResponse } from "@/lib/http";
import { requestArtifactUpload } from "@/lib/artifacts";
import { artifactInitSchema } from "@/lib/validation";

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const auth = await authenticateRequest(request);
    const body = artifactInitSchema.parse(await request.json());
    // 201 with PUT tickets: the client uploads bytes direct to storage.
    return Response.json(await requestArtifactUpload(auth, body, body.files), {
      status: 201,
    });
  } catch (e) {
    return toErrorResponse(e);
  }
}
