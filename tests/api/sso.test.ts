import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { exportJWK, generateKeyPair, SignJWT, type JWTPayload } from "jose";

import { GET as callbackGET } from "@/app/api/v1/auth/oidc/callback/route";
import { GET as startGET } from "@/app/api/v1/auth/oidc/start/route";
import { POST as loginPOST } from "@/app/api/v1/auth/login/route";
import { POST as invitePOST } from "@/app/api/v1/team/invite/route";
import { DELETE as deleteMember } from "@/app/api/v1/team/members/[userId]/route";
import { getLiveSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import {
  apiRequest,
  apiTestsEnabled,
  authedRequest,
  createTestOrg,
  testEmail,
} from "../helpers";

// Stub OIDC provider with real RSA-signed ID tokens (no mocks of jose).
const stub = {
  claims: {} as JWTPayload,
  code: "auth-code-1",
  privateKey: null as
    Awaited<ReturnType<typeof generateKeyPair>>["privateKey"] | null,
  publicJwk: null as Record<string, unknown> | null,
  base: "",
};

async function startStub(): Promise<Server> {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  stub.privateKey = privateKey;
  stub.publicJwk = {
    ...(await exportJWK(publicKey)),
    kid: "stub-1",
    alg: "RS256",
    use: "sig",
  };
  const server = createServer((req, res) => {
    const send = (code: number, body: unknown) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.url === "/.well-known/openid-configuration") {
      send(200, {
        issuer: stub.base,
        authorization_endpoint: `${stub.base}/auth`,
        token_endpoint: `${stub.base}/token`,
        jwks_uri: `${stub.base}/jwks`,
      });
    } else if (req.url === "/jwks") {
      send(200, { keys: [stub.publicJwk] });
    } else if (req.url === "/token" && req.method === "POST") {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", async () => {
        if (!new URLSearchParams(data).get("code")) {
          send(400, { error: "bad_grant" });
          return;
        }
        const idToken = await new SignJWT({ ...stub.claims })
          .setProtectedHeader({ alg: "RS256", kid: "stub-1" })
          .setIssuer(stub.base)
          .setAudience(process.env["OIDC_CLIENT_ID"]!)
          .sign(stub.privateKey!);
        send(200, { id_token: idToken, token_type: "Bearer" });
      });
    } else {
      send(404, {});
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  stub.base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return server;
}

function withOidcEnv(orgSlug?: string) {
  process.env["OIDC_ISSUER"] = stub.base;
  process.env["OIDC_CLIENT_ID"] = "test-client";
  process.env["OIDC_CLIENT_SECRET"] = "test-secret";
  delete process.env["OIDC_ALLOWED_DOMAINS"];
  if (orgSlug) process.env["OIDC_ORG_SLUG"] = orgSlug;
  else delete process.env["OIDC_ORG_SLUG"];
}

function clearOidcEnv() {
  delete process.env["OIDC_ISSUER"];
  delete process.env["OIDC_CLIENT_ID"];
  delete process.env["OIDC_CLIENT_SECRET"];
  delete process.env["OIDC_ALLOWED_DOMAINS"];
  delete process.env["OIDC_ORG_SLUG"];
}

async function callback(
  code: string,
  state: string,
  nonce: string,
  orgSlug: string,
) {
  const req = new NextRequest(
    `http://app.test/api/v1/auth/oidc/callback?code=${code}&state=${state}`,
    {
      headers: {
        cookie: `cursus_oidc_state=${state}; cursus_oidc_nonce=${nonce}`,
      },
    },
  );
  void orgSlug;
  return callbackGET(req);
}

describe.skipIf(!apiTestsEnabled)("sso routes", () => {
  it("start redirects when configured, 404s when not", async () => {
    const org = await createTestOrg("sso");
    try {
      const server = await startStub();
      try {
        withOidcEnv();
        const res = await startGET(
          new NextRequest("http://app.test/api/v1/auth/oidc/start"),
        );
        expect(res.status).toBe(307);
        const location = res.headers.get("location") ?? "";
        expect(location.startsWith(`${stub.base}/auth?`)).toBe(true);
        expect(location).toContain("client_id=test-client");
        const setCookie = res.headers.get("set-cookie") ?? "";
        expect(setCookie).toContain("cursus_oidc_state=");
      } finally {
        server.close();
        clearOidcEnv();
      }
      const off = await startGET(
        new NextRequest("http://app.test/api/v1/auth/oidc/start"),
      );
      expect(off.status).toBe(404);
    } finally {
      await org.cleanup();
    }
  });

  it("JIT-provisions members; sessions are alive; password login impossible", async () => {
    const org = await createTestOrg("sso");
    const server = await startStub();
    try {
      withOidcEnv(org.orgSlug);
      stub.claims = {
        sub: "jit-1",
        email: testEmail("sso-jit"),
        email_verified: true,
        name: "SSO Jit",
        nonce: "n1",
      };
      const res = await callback("auth-code-1", "s1", "n1", org.orgSlug);
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toContain(
        `/${org.orgSlug}/dashboard`,
      );
      const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0]!;
      const session = await getLiveSession(
        new NextRequest("http://app.test/x", { headers: { cookie } }),
      );
      expect(session?.email).toBe(stub.claims.email);
      expect(session?.role).toBe("MEMBER");
      const row = await db.user.findUniqueOrThrow({
        where: { email: stub.claims.email as string },
      });
      expect(row.name).toBe("SSO Jit");
      expect(row.passwordHash.startsWith("!sso-")).toBe(true);
      expect(row.ssoSubject).toBe(`${stub.base}|jit-1`);

      // No password exists to guess — login rejects.
      const login = await loginPOST(
        apiRequest("/api/v1/auth/login", {
          method: "POST",
          body: { email: stub.claims.email, password: "anything-1A!" },
        }),
      );
      expect(login.status).toBe(401);

      // Second login links by subject, same account.
      const again = await callback("auth-code-1", "s2", "n1", org.orgSlug);
      expect(again.status).toBe(307);
      expect(
        await db.user.count({ where: { email: stub.claims.email as string } }),
      ).toBe(1);
    } finally {
      server.close();
      clearOidcEnv();
      await org.cleanup();
    }
  });

  it("activates pending invites, links password accounts, keeps the dead dead", async () => {
    const org = await createTestOrg("sso");
    const server = await startStub();
    try {
      withOidcEnv(org.orgSlug);
      // Pending invite activates with the token's name.
      const pendingEmail = testEmail("sso-pending");
      await invitePOST(
        await authedRequest("/api/v1/team/invite", org.admin, {
          method: "POST",
          body: { email: pendingEmail },
        }),
      );
      stub.claims = {
        sub: "pend-1",
        email: pendingEmail,
        email_verified: true,
        name: "Pending Person",
        nonce: "n2",
      };
      const activated = await callback("auth-code-1", "s3", "n2", org.orgSlug);
      expect(activated.status).toBe(307);
      const pendingRow = await db.user.findUniqueOrThrow({
        where: { email: pendingEmail },
      });
      expect(pendingRow.name).toBe("Pending Person");
      expect(pendingRow.passwordHash.startsWith("!sso-")).toBe(true);

      // Password account links SSO subject, keeps its password.
      stub.claims = {
        sub: "link-1",
        email: org.member.email,
        email_verified: true,
        name: "Ignored Name",
        nonce: "n3",
      };
      const linked = await callback("auth-code-1", "s4", "n3", org.orgSlug);
      expect(linked.status).toBe(307);
      const linkedRow = await db.user.findUniqueOrThrow({
        where: { email: org.member.email },
      });
      expect(linkedRow.ssoSubject).toBe(`${stub.base}|link-1`);

      // Deactivated accounts stay dead over SSO.
      await deleteMember(
        await authedRequest(`/api/v1/team/members/${linkedRow.id}`, org.admin, {
          method: "DELETE",
        }),
        { params: Promise.resolve({ userId: linkedRow.id }) },
      );
      const dead = await callback("auth-code-1", "s5", "n3", org.orgSlug);
      expect(dead.status).toBe(307);
      expect(dead.headers.get("location")).toContain("/login?error=");

      // Unverified email and wrong nonce refuse.
      stub.claims = {
        sub: "bad-1",
        email: testEmail("sso-bad"),
        email_verified: false,
        name: "",
        nonce: "n4",
      };
      const unverified = await callback("auth-code-1", "s6", "n4", org.orgSlug);
      expect(unverified.headers.get("location")).toContain("/login?error=");
      stub.claims = {
        sub: "bad-2",
        email: testEmail("sso-bad2"),
        email_verified: true,
        name: "",
        nonce: "right",
      };
      const wrongNonce = await callback(
        "auth-code-1",
        "s7",
        "wrong",
        org.orgSlug,
      );
      expect(wrongNonce.headers.get("location")).toContain("/login?error=");

      // Domain allowlist refuses outsiders.
      process.env["OIDC_ALLOWED_DOMAINS"] = "example.com";
      stub.claims = {
        sub: "bad-3",
        email: "someone@else.test",
        email_verified: true,
        name: "",
        nonce: "n5",
      };
      const domain = await callback("auth-code-1", "s8", "n5", org.orgSlug);
      expect(domain.headers.get("location")).toContain("/login?error=");
    } finally {
      server.close();
      clearOidcEnv();
      await org.cleanup();
    }
  });
});
