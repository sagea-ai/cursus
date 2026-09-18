import { expect, test, type APIRequestContext } from "@playwright/test";

// Full critical journey on a FRESH database (PRD §10.2):
// onboarding UI → login → project → API key → SDK-style run logging →
// run list → detail/charts → rename → compare → invite member → accept →
// restricted permissions. Requires E2E_DATABASE_URL (throwaway postgres);
// scripts/e2e-local.sh rebuilds and sets BOOTSTRAP_ADMIN_EMAIL to match
// ADMIN below. The config starts `next start` on :3100 automatically.

const ADMIN = {
  name: "E2E Admin",
  email: "admin@e2e.test",
  password: "admin-password-1",
};
const MEMBER = { email: "member@e2e.test", password: "member-password-1" };

function sessionCookie(setCookie: string | null): string {
  const m = /cursus_session=([^;]+)/.exec(setCookie ?? "");
  if (!m) throw new Error("no session cookie in login response");
  return `cursus_session=${m[1]}`;
}

async function apiLogin(
  request: APIRequestContext,
  email: string,
  password: string,
): Promise<{ cookie: string; orgSlug: string }> {
  const res = await request.post("/api/v1/auth/login", {
    data: { email, password },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return {
    cookie: sessionCookie(res.headers()["set-cookie"] ?? null),
    orgSlug: body.org.slug as string,
  };
}

test("critical journey: bootstrap to restricted member", async ({
  page,
  request,
}) => {
  // 1. Onboarding UI on the fresh DB: wrong email rejected generically,
  // correct email continues; disclaimer checkbox gates submit.
  await page.goto("/onboarding");
  await page.getByLabel("Bootstrap email").fill("intruder@e2e.test");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Your name").fill(ADMIN.name);
  await page.getByLabel("Organization name").fill("E2E Org");
  await page.getByLabel("Password", { exact: true }).fill(ADMIN.password);
  await page.getByLabel("Confirm password").fill(ADMIN.password);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByText("not authorized for onboarding")).toBeVisible();

  await page.getByRole("button", { name: "Back" }).click();
  await page.getByLabel("Bootstrap email").fill(ADMIN.email);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Your name").fill(ADMIN.name);
  // Org name comes prefilled from BOOTSTRAP_ORG_NAME.
  await expect(page.getByLabel("Organization name")).toHaveValue("E2E Org");
  await page.getByLabel("Password", { exact: true }).fill(ADMIN.password);
  await page.getByLabel("Confirm password").fill("mismatch-password");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByText("Passwords do not match")).toBeVisible();
  await page.getByLabel("Confirm password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/[^/]+\/projects/);
  const orgSlug = page.url().split("/").slice(-2, -1)[0]!;

  // Onboarding is now permanently closed: an anonymous revisit lands on
  // login (a logged-in admin would bounce login → projects instead).
  await page.context().clearCookies();
  await page.goto("/onboarding");
  await expect(page).toHaveURL("/login");

  // 2. Login via UI → empty projects with the SDK snippet.
  await page.goto("/login");
  await page.getByLabel("Email address").fill(ADMIN.email);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(`/${orgSlug}/projects`);
  await expect(page.getByText("No projects yet")).toBeVisible();

  // 3. Create a project via UI.
  await page.getByRole("button", { name: "New Project" }).click();
  await page.getByLabel("Name").fill("e2e-proj");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("link", { name: /e2e-proj/ })).toBeVisible();

  // 4. Create an API key via UI (reveal-once) and log runs SDK-style.
  await page.goto(`/${orgSlug}/settings/keys`);
  await page.getByRole("button", { name: "Create Key" }).click();
  await page.getByLabel("Label").fill("e2e-box");
  await page.getByRole("button", { name: "Create key" }).click();
  await expect(page.getByText("you won't see this again")).toBeVisible();
  const plaintext =
    (await page.locator("code").last().textContent())?.trim() ?? "";
  expect(plaintext).toMatch(/^cursus_/);

  const headers = { Authorization: `Bearer ${plaintext}` };
  const runIds: string[] = [];
  for (const [name, lr] of [
    ["run-a", 0.01],
    ["run-b", 0.001],
  ] as const) {
    const mk = await request.post("/api/v1/runs", {
      headers,
      data: { project: "e2e-proj", name, config: { lr }, tags: ["e2e"] },
    });
    expect(mk.ok()).toBeTruthy();
    const runId = ((await mk.json()).run_id as string) ?? "";
    runIds.push(runId);
    const pts = Array.from({ length: 20 }, (_, step) => ({
      key: "train/loss",
      step,
      value: 1 / (step + 1),
    }));
    const log = await request.post(`/api/v1/runs/${runId}/log`, {
      headers,
      data: { points: pts },
    });
    expect(log.status()).toBe(202);
    const fin = await request.post(`/api/v1/runs/${runId}/finish`, {
      headers,
      data: { status: "finished" },
    });
    expect(fin.ok()).toBeTruthy();
  }

  // 5. Run list shows both; detail renders charts + config.
  await page.goto(`/${orgSlug}/e2e-proj/runs`);
  await expect(page.getByRole("link", { name: "run-a" })).toBeVisible();
  await expect(page.getByRole("link", { name: "run-b" })).toBeVisible();
  await page.getByRole("link", { name: "run-a" }).click();
  await expect(page.getByRole("tab", { name: "Charts" })).toBeVisible();
  await page.locator("svg").first().waitFor({ timeout: 15_000 });
  await page.getByRole("tab", { name: "Config" }).click();
  await expect(page.getByText("0.01").first()).toBeVisible();

  // Inline rename persists.
  await page.getByRole("tab", { name: "Charts" }).click();
  await page.getByRole("button", { name: "Rename run" }).click();
  await page.getByLabel("Run name").fill("run-a-renamed");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(
    page.getByRole("heading", { name: "run-a-renamed" }),
  ).toBeVisible();

  // 6. Compare two runs: overlay + config diff (lr differs).
  await page.goto(`/${orgSlug}/e2e-proj/runs/compare?ids=${runIds.join(",")}`);
  await expect(page.getByText("run-a").first()).toBeVisible();
  await expect(page.getByText("Config diff")).toBeVisible();
  await expect(page.getByText("0.001").first()).toBeVisible();

  // 7. Invite a member; accept via link; land in dashboard.
  await page.goto(`/${orgSlug}/team`);
  await page.getByRole("button", { name: "Invite Member" }).click();
  await page.getByLabel("Email").fill(MEMBER.email);
  await page.getByRole("button", { name: "Generate invite link" }).click();
  const link = (await page.locator("code").last().textContent())?.trim() ?? "";
  expect(link).toContain("/invite/");
  // The open dialog traps focus — close it before touching the sidebar.
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/login");

  await page.goto(link);
  await expect(page.getByText(MEMBER.email)).toBeVisible();
  await page.getByLabel("Choose a password").fill(MEMBER.password);
  await page.getByLabel("Confirm password").fill(MEMBER.password);
  await page.getByRole("button", { name: "Set password and join" }).click();
  await expect(page).toHaveURL(`/${orgSlug}/projects`);

  // 8. Restricted permissions: no invite UI, no row actions, own keys only.
  await page.goto(`/${orgSlug}/team`);
  await expect(page.getByRole("button", { name: "Invite Member" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("cell", { name: MEMBER.email })).toBeVisible();

  const { cookie: memberCookie } = await apiLogin(
    request,
    MEMBER.email,
    MEMBER.password,
  );
  const forbidden = await request.post("/api/v1/team/invite", {
    headers: { Cookie: memberCookie },
    data: { email: "nope@e2e.test" },
  });
  expect(forbidden.status()).toBe(403);
});
