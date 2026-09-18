import type { NextRequest } from "next/server";

import { authenticateRequest } from "@/lib/api-auth";
import { getArtifactDetail } from "@/lib/artifacts";
import { toErrorResponse } from "@/lib/http";

export async function GET(
  request: NextRequest,
  ctx: {
    params: Promise<{ orgSlug: string; projectSlug: string; name: string }>;
  },
): Promise<Response> {
  try {
    const { projectSlug, name } = await ctx.params;
    const auth = await authenticateRequest(request);
    const vRaw = request.nextUrl.searchParams.get("v") ?? "latest";
    const version =
      vRaw === "latest" ? ("latest" as const) : Number.parseInt(vRaw, 10);
    if (version !== "latest" && !Number.isInteger(version)) {
      return Response.json({ error: "invalid version" }, { status: 400 });
    }
    const artifactName = decodeURIComponent(name);
    return Response.json({
      artifact: await getArtifactDetail(
        auth,
        projectSlug,
        artifactName,
        version,
      ),
    });
  } catch (e) {
    return toErrorResponse(e);
  }
}
