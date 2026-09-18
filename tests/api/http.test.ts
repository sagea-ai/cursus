import { describe, expect, it } from "vitest";

import { AuthError } from "@/lib/auth";
import { KeyAuthError } from "@/lib/api-auth";
import { ApiError, isNotFoundError } from "@/lib/http";

// Lives in tests/api/ (not lib/) purely because importing the error classes
// pulls in lib/db, which requires DATABASE_URL at import time. The logic
// itself is pure; the RUN_API_TESTS gate is about the import chain.
describe("isNotFoundError", () => {
  it("is true only for 404s, never for auth or server errors", () => {
    expect(isNotFoundError(new KeyAuthError(404, "x"))).toBe(true);
    expect(isNotFoundError(new ApiError(404, "x"))).toBe(true);
    expect(isNotFoundError(new KeyAuthError(401, "x"))).toBe(false);
    expect(isNotFoundError(new AuthError(403, "x"))).toBe(false);
    expect(isNotFoundError(new ApiError(409, "x"))).toBe(false);
    expect(isNotFoundError(new Error("boom"))).toBe(false);
  });
});
