import type { NextRequest } from "next/server";

import { authenticateRequest } from "@/lib/api-auth";
import { downloadArtifactFile } from "@/lib/artifacts";
import { toErrorResponse } from "@/lib/http";

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ fileId: string }> },
): Promise<Response> {
  try {
    const { fileId } = await ctx.params;
    const auth = await authenticateRequest(request);
    const file = await downloadArtifactFile(auth, fileId);
    const filename = file.path.split("/").pop() ?? "file";
    // Blob accepts the Buffer directly and is universally valid BodyInit.
    return new Response(new Blob([file.data]), {
      headers: {
        "content-type": "application/octet-stream",
        "content-disposition": `attachment; filename="${filename}"`,
        "content-length": String(file.sizeBytes),
        "cache-control": "private, max-age=3600",
      },
    });
  } catch (e) {
    return toErrorResponse(e);
  }
}
