import { API_VERSION } from "@/lib/runs";

// SDK version gate (PRD §8.3): init() checks this before creating a run and
// fails loudly on mismatch instead of erroring confusingly mid-training.
export async function GET(): Promise<Response> {
  return Response.json({ ok: true, api_version: API_VERSION });
}
