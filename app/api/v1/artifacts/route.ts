import type { NextRequest } from "next/server";

import { authenticateRequest } from "@/lib/api-auth";
import { createArtifactVersion } from "@/lib/artifacts";
import { toErrorResponse } from "@/lib/http";
import { artifactUploadFieldsSchema } from "@/lib/validation";

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const auth = await authenticateRequest(request);
    const form = await request.formData();
    const fields = artifactUploadFieldsSchema.parse({
      name: form.get("name"),
      type: form.get("type") ?? undefined,
      description: form.get("description") ?? undefined,
      project: form.get("project") ?? undefined,
      run_id: form.get("run_id") ?? undefined,
    });
    const uploads = [];
    for (const entry of form.getAll("files")) {
      if (!(entry instanceof File)) {
        return Response.json(
          { error: "files must be uploaded as files" },
          { status: 400 },
        );
      }
      uploads.push({
        path: entry.name,
        data: new Uint8Array(await entry.arrayBuffer()),
      });
    }
    const created = await createArtifactVersion(auth, fields, uploads);
    return Response.json(created, { status: 201 });
  } catch (e) {
    return toErrorResponse(e);
  }
}
