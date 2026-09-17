import { ZodError } from "zod";

import { AuthError } from "@/lib/auth";
import { KeyAuthError } from "@/lib/api-auth";

// Shared error mapping for API routes: handlers stay thin and consistent.
// Zod → 400, auth → 401/403, missing → 404, everything else → 500 (no stack
// leak to clients).
export function toErrorResponse(e: unknown): Response {
  if (e instanceof ZodError) {
    return Response.json(
      { error: "invalid request", details: e.issues },
      { status: 400 },
    );
  }
  if (e instanceof AuthError) {
    return Response.json({ error: e.message }, { status: e.status });
  }
  if (e instanceof KeyAuthError) {
    return Response.json({ error: e.message }, { status: e.status });
  }
  console.error("unhandled API error", e);
  return Response.json({ error: "internal error" }, { status: 500 });
}
