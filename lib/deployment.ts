import { headers } from "next/headers";

// The deployment's own base URL (what the SDK must point at). Derived
// per-request from Host: correct for localhost dev, compose, Vercel, and
// custom domains with zero configuration. Protocol trusts
// x-forwarded-proto behind proxies, else localhost ⇒ http.
export async function deploymentBaseUrl(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const forwarded = h.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol =
    forwarded ||
    (host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https");
  return `${protocol}://${host}`;
}
