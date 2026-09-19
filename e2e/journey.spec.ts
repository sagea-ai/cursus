import { expect, test, type APIRequestContext } from "@playwright/test";

// Full critical journey on a FRESH database:
// onboarding UI → login → project → API key → SDK-style run logging →
// run list → detail/charts → rename → compare → invite member → accept →
// restricted permissions. Requires E2E_DATABASE_URL (throwaway postgres);
// scripts/e2e-local.sh rebuilds and sets BOOTSTRAP_ADMIN_EMAIL to match
// ADMIN below. The config starts `next start` on :3100 automatically.

const ADMIN = {
  name: "E2E Admin",
  email: "admin@e2e.test",
  password: "Admin-password-1",
};
const MEMBER = { email: "member@e2e.test", password: "Member-password-1" };
const OUTSIDER = {
  email: "outsider@e2e.test",
  password: "Outsider-password-1",
};
const VIEWER = { email: "viewer@e2e.test", password: "Viewer-password-1" };

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
  // 0. Fresh deployment: / and /login both route to onboarding (login can
  // never succeed with zero users, so showing it first strands newcomers).
  await page.goto("/");
  await expect(page).toHaveURL("/onboarding");
  await page.goto("/login");
  await expect(page).toHaveURL("/onboarding");

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
  // Realtime password checklist is visible before typing anything.
  await expect(page.getByText("At least 12 characters")).toBeVisible();
  // Org name comes prefilled from BOOTSTRAP_ORG_NAME.
  await expect(page.getByLabel("Organization name")).toHaveValue("E2E Org");
  await page.getByLabel("Password", { exact: true }).fill(ADMIN.password);
  await page.getByLabel("Confirm password").fill("mismatch-password");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create workspace" }).click();
  // NOTE: getByRole("alert") doesn't resolve live-region roles in this
  // Playwright version (verified empirically) — CSS attribute selector.
  await expect(page.locator('form p[role="alert"]')).toContainText(
    "Passwords do not match",
  );
  await page.getByLabel("Confirm password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/[^/]+\/dashboard/);
  const orgSlug = page.url().split("/").slice(-2, -1)[0]!;

  // Onboarding is now permanently closed: an anonymous revisit lands on
  // login (a logged-in admin would bounce login → projects instead).
  await page.context().clearCookies();
  await page.goto("/onboarding");
  await expect(page).toHaveURL("/login");

  // 2. Login via UI → dashboard with getting-started (fresh org).
  await page.goto("/login");
  await page.getByLabel("Email address").fill(ADMIN.email);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(`/${orgSlug}/dashboard`);
  await expect(page.getByText("Set up your first run")).toBeVisible();

  // 3. Create a project via UI.
  await page.goto(`/${orgSlug}/projects`);
  await page.getByRole("button", { name: "New Project" }).click();
  await page.getByLabel("Name").fill("e2e-proj");
  await page.getByRole("button", { name: "Create project" }).click();
  // Whole-row tables link by name; the card grid is gone.
  await expect(page.getByText("e2e-proj", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "e2e-proj", exact: true }).click();
  await expect(page).toHaveURL(`/${orgSlug}/e2e-proj`);

  // 3a. Project overview: stats, API docs, rename, and API-keys tab.
  await page.goto(`/${orgSlug}/e2e-proj`);
  await expect(page.getByText("Total runs")).toBeVisible();
  await expect(page.getByText("Export metrics to CSV")).toBeVisible();
  await page.getByRole("button", { name: "Rename project" }).click();
  await page.getByRole("textbox", { name: "Project name" }).fill("E2E Renamed");
  await page.getByRole("button", { name: "Save project name" }).click();
  await expect(
    page.getByRole("heading", { name: "E2E Renamed" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "API keys" }).click();
  await expect(page.getByRole("button", { name: "Create Key" })).toBeVisible();

  // 4. Create an API key via UI (reveal-once) and log runs SDK-style.
  await page.goto(`/${orgSlug}/settings/keys`);
  await page.getByRole("button", { name: "Create Key" }).click();
  await page.getByLabel("Label").fill("e2e-box");
  await page.getByRole("button", { name: "Create key" }).click();
  await expect(page.getByText("you won't see this again")).toBeVisible();
  const firstPlaintext =
    (
      await page.getByRole("dialog").locator("code").first().textContent()
    )?.trim() ?? "";
  expect(firstPlaintext).toMatch(/^cursus_/);
  await page.keyboard.press("Escape");

  // 4a. Rotate (reshuffle) the key in the UI: confirm in the dialog,
  // replacement revealed once, old secret dies immediately.
  await page.getByRole("button", { name: "Rotate" }).click();
  await expect(page.getByText("Rotate API key")).toBeVisible();
  await page.getByRole("button", { name: "Rotate key", exact: true }).click();
  await expect(page.getByText("Key rotated")).toBeVisible();
  const plaintext =
    (
      await page.getByRole("dialog").locator("code").first().textContent()
    )?.trim() ?? "";
  expect(plaintext).toMatch(/^cursus_/);
  expect(plaintext).not.toBe(firstPlaintext);
  await page.keyboard.press("Escape");

  // Per-key history page shows the trail (created + rotated).
  await page.getByRole("link", { name: "History" }).click();
  await expect(page.getByText("Created", { exact: true })).toBeVisible();
  await expect(page.getByText("Rotated", { exact: true })).toBeVisible();
  await page.goBack();

  const deadCheck = await request.post("/api/v1/runs", {
    headers: { Authorization: `Bearer ${firstPlaintext}` },
    data: { project: "e2e-proj", name: "should-fail" },
  });
  expect(deadCheck.status()).toBe(401);

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

  // 4c. Groups: admin creates the group via UI; the second invitee is
  // created via API first so the UI member-add has someone to add. A
  // project is created inside the group via UI; runs inherit its
  // visibility. MEMBER (invited later, never added) is the stranger who
  // must see neither group, project, nor run.
  await page.goto(`/${orgSlug}/groups`);
  await page.getByRole("button", { name: "New Group" }).click();
  await page.getByLabel("Name").fill("e2e-group");
  await page.getByRole("button", { name: "Create group" }).click();
  await expect(page.getByText("e2e-group", { exact: true })).toBeVisible();

  const { cookie: adminCookie } = await apiLogin(
    request,
    ADMIN.email,
    ADMIN.password,
  );
  const inv2 = await request.post("/api/v1/team/invite", {
    headers: { Cookie: adminCookie },
    data: { email: OUTSIDER.email },
  });
  expect(inv2.ok()).toBeTruthy();
  const inv2Url = ((await inv2.json()).inviteUrl as string) ?? "";
  const inv2Token = inv2Url.split("/").pop()!;
  const acc2 = await request.post("/api/v1/auth/invites/accept", {
    data: {
      token: inv2Token,
      password: OUTSIDER.password,
      name: "E2E Outsider",
    },
  });
  expect(acc2.ok()).toBeTruthy();

  await page.getByRole("link", { name: /e2e-group/ }).click();
  await page.getByLabel("Add by email").fill(OUTSIDER.email);
  await page.getByRole("button", { name: "Add" }).click();
  await expect(
    page.getByRole("cell", { name: OUTSIDER.email, exact: true }),
  ).toBeVisible();

  // Project created inside the group via UI (group picker in the dialog).
  await page.goto(`/${orgSlug}/projects`);
  await page.getByRole("button", { name: "New Project" }).click();
  await page.getByLabel("Name", { exact: true }).fill("e2e-group-proj");
  await page.getByLabel("Group (optional)").selectOption("e2e-group");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByText("e2e-group-proj", { exact: true })).toBeVisible();

  const grun = await request.post("/api/v1/runs", {
    headers,
    data: { project: "e2e-group-proj", name: "group-run" },
  });
  expect(grun.ok()).toBeTruthy();
  const groupRunId = ((await grun.json()).run_id as string) ?? "";
  await page.goto(`/${orgSlug}/groups/e2e-group`);
  await expect(page.getByText("e2e-group-proj", { exact: true })).toBeVisible();

  // Outsider is a member: sees group and run.
  const { cookie: outsiderCookie } = await apiLogin(
    request,
    OUTSIDER.email,
    OUTSIDER.password,
  );
  const oh = { Cookie: outsiderCookie };
  const oGroups = await request.get("/api/v1/groups", { headers: oh });
  expect(
    ((await oGroups.json()).groups as { slug: string }[]).map((g) => g.slug),
  ).toContain("e2e-group");
  const oRun = await request.get(`/api/v1/runs/${groupRunId}`, {
    headers: oh,
  });
  expect(oRun.status()).toBe(200);

  // 4d. Attach an artifact to the first run, browse it in the UI.
  const up = await request.post("/api/v1/artifacts", {
    headers,
    multipart: {
      name: "e2e-weights",
      type: "model",
      description: "journey artifact",
      run_id: runIds[0]!,
      files: {
        name: "best.pt",
        mimeType: "application/octet-stream",
        buffer: Buffer.from("e2e-bytes"),
      },
    },
  });
  expect(up.status()).toBe(201);
  await page.goto(`/${orgSlug}/e2e-proj/artifacts`);
  await expect(page.getByRole("link", { name: /e2e-weights/ })).toBeVisible();
  await page.getByRole("link", { name: /e2e-weights/ }).click();
  await expect(page.getByText("best.pt")).toBeVisible();
  await expect(page.getByText("journey artifact")).toBeVisible();

  // 5. Run list shows both; sort control reorders server-side.
  await page.goto(`/${orgSlug}/e2e-proj/runs`);
  await expect(page.getByRole("link", { name: "run-a" })).toBeVisible();
  await expect(page.getByRole("link", { name: "run-b" })).toBeVisible();
  await page.getByRole("link", { name: "Name A–Z" }).click();
  await expect(page).toHaveURL(/sort=name_asc/);
  // Alphabetical across the project's runs: run-a, run-b.
  const firstRow = page.getByRole("row").nth(1);
  await expect(firstRow.getByRole("link", { name: "run-a" })).toBeVisible();

  // Dashboard reflects the logged runs (admin scope).
  await page.goto(`/${orgSlug}/dashboard`);
  await expect(page.getByText("Recent runs")).toBeVisible();
  await expect(page.getByRole("link", { name: "run-a" })).toBeVisible();
  await expect(page.getByText("Status mix")).toBeVisible();
  await expect(page.getByText("Top projects")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "E2E Renamed" }).first(),
  ).toBeVisible();

  await page.goto(`/${orgSlug}/e2e-proj/runs?sort=name_asc`);
  await page.getByRole("link", { name: "run-a" }).click();
  await expect(page.getByRole("tab", { name: "Charts" })).toBeVisible();
  await page.locator("svg").first().waitFor({ timeout: 15_000 });
  await page.getByRole("tab", { name: "Config" }).click();
  await expect(page.getByText("0.01").first()).toBeVisible();
  // Mid-run config sync lands on the Config tab (run-a is finished by
  // now, so sync a fresh running run instead).
  const cfgRun = await request.post("/api/v1/runs", {
    headers: { Cookie: adminCookie },
    data: { project: "e2e-proj", name: "cfg-run" },
  });
  expect(cfgRun.ok()).toBeTruthy();
  const cfgId = ((await cfgRun.json()) as { run_id: string }).run_id;
  const cfg = await request.patch(`/api/v1/runs/${cfgId}/config`, {
    headers: { Cookie: adminCookie },
    data: { config: { e2e_note: "synced-mid-run" } },
  });
  expect(cfg.ok()).toBeTruthy();
  await page.goto(`/${orgSlug}/e2e-proj/runs/${cfgId}`);
  await page.getByRole("tab", { name: "Config" }).click();
  await expect(page.getByText("synced-mid-run").first()).toBeVisible();

  // Inline rename persists.
  await page.getByRole("tab", { name: "Charts" }).click();
  await page.getByRole("button", { name: "Rename run" }).click();
  await page.getByLabel("Run name").fill("run-a-renamed");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(
    page.getByRole("heading", { name: "run-a-renamed" }),
  ).toBeVisible();

  // Overview tab: run path plus editable notes.
  await page.getByRole("tab", { name: "Overview" }).click();
  await page.getByLabel("Notes").fill("e2e was here");
  await page.getByRole("button", { name: "Save notes" }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();

  // 6. Compare two runs: overlay + config diff (lr differs).
  await page.goto(`/${orgSlug}/e2e-proj/runs/compare?ids=${runIds.join(",")}`);
  await expect(page.getByText("run-a").first()).toBeVisible();
  await expect(page.getByText("Config diff")).toBeVisible();
  await expect(page.getByText("0.001").first()).toBeVisible();

  // 6b. Media: presigned ticket → direct PUT → complete → viewer shows it.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const ticket = await request.post(
    `/api/v1/runs/${runIds[0]}/media/upload-url`,
    {
      headers: { Cookie: adminCookie },
      data: {
        key: "val/samples",
        step: 1,
        mime: "image/png",
        sizeBytes: png.length,
      },
    },
  );
  expect(ticket.ok()).toBeTruthy();
  const { url, mediaId } = (await ticket.json()) as {
    url: string;
    mediaId: string;
  };
  const put = await request.put(url, {
    data: png,
    headers: { "Content-Type": "image/png" },
  });
  expect(put.ok()).toBeTruthy();
  const done = await request.post(
    `/api/v1/runs/${runIds[0]}/media/${mediaId}/complete`,
    { headers: { Cookie: adminCookie } },
  );
  expect(done.ok()).toBeTruthy();
  await page.goto(`/${orgSlug}/e2e-proj/runs/${runIds[0]}`);
  await expect(page.getByRole("tab", { name: "Charts" })).toBeVisible();
  await expect(page.getByAltText("val/samples at step 1")).toBeVisible();

  // 6c. Sweeps: 2x2 grid via API, four linked trials, detail lists them.
  const sw = await request.post(`/api/v1/projects/e2e-proj/sweeps`, {
    headers: { Cookie: adminCookie },
    data: {
      name: "e2e-grid",
      method: "GRID",
      space: { lr: { values: [0.1, 0.2] }, bs: { values: [16, 32] } },
    },
  });
  expect(sw.ok()).toBeTruthy();
  const sweepId = ((await sw.json()) as { id: string }).id;
  for (let i = 0; i < 4; i++) {
    const trial = await request.post(`/api/v1/sweeps/${sweepId}/next`, {
      headers: { Cookie: adminCookie },
    });
    expect(trial.ok()).toBeTruthy();
    const { config } = (await trial.json()) as {
      config: Record<string, number>;
    };
    const tr = await request.post("/api/v1/runs", {
      headers: { Cookie: adminCookie },
      data: {
        project: "e2e-proj",
        name: `sweep-trial-${i}`,
        config,
        sweep_id: sweepId,
      },
    });
    expect(tr.ok()).toBeTruthy();
  }
  const exhausted = await request.post(`/api/v1/sweeps/${sweepId}/next`, {
    headers: { Cookie: adminCookie },
  });
  expect(exhausted.status()).toBe(204);
  await page.goto(`/${orgSlug}/e2e-proj/sweeps/${sweepId}`);
  await expect(page.getByRole("heading", { name: "e2e-grid" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "sweep-trial-0" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "sweep-trial-3" })).toBeVisible();

  // 6d. Bulk ops: tag two runs, delete a third, all from the table bar.
  await page.goto(`/${orgSlug}/e2e-proj/runs`);
  await page.getByRole("checkbox", { name: "Select run-a-renamed" }).check();
  await page.getByRole("checkbox", { name: "Select run-b" }).check();
  await page.getByLabel("Bulk tag").fill("e2e-bulk");
  await page.getByRole("button", { name: "Tag", exact: true }).click();
  await expect(page.getByText("e2e-bulk").first()).toBeVisible();
  await page.getByRole("checkbox", { name: "Select sweep-trial-3" }).check();
  await page.getByRole("button", { name: "Delete…" }).click();
  await expect(page.getByText("Delete 1 runs?")).toBeVisible();
  await page.getByRole("button", { name: "Delete runs" }).click();
  await expect(page.getByRole("cell", { name: "sweep-trial-3" })).toHaveCount(
    0,
  );

  // 6e. Retention: archive a throwaway project, badge shows, writes 409,
  // unarchive restores.
  const tmpRun = await request.post("/api/v1/runs", {
    headers: { Cookie: adminCookie },
    data: { project: "e2e-ret", name: "ret-run" },
  });
  expect(tmpRun.ok()).toBeTruthy();
  const tmpId = ((await tmpRun.json()) as { run_id: string }).run_id;
  const arch = await request.post(
    `/api/v1/orgs/${orgSlug}/projects/e2e-ret/archive`,
    { headers: { Cookie: adminCookie }, data: { archived: true } },
  );
  expect(arch.ok()).toBeTruthy();
  await page.goto(`/${orgSlug}/e2e-ret`);
  await expect(page.getByText("Archived — read-only")).toBeVisible();
  const blockedLog = await request.post(`/api/v1/runs/${tmpId}/log`, {
    headers: { Cookie: adminCookie },
    data: { points: [{ key: "k", step: 0, value: 1 }] },
  });
  expect(blockedLog.status()).toBe(409);
  const unarch = await request.post(
    `/api/v1/orgs/${orgSlug}/projects/e2e-ret/archive`,
    { headers: { Cookie: adminCookie }, data: { archived: false } },
  );
  expect(unarch.ok()).toBeTruthy();

  // 7. Invite a member; accept via link; land in dashboard.
  await page.goto(`/${orgSlug}/team`);
  await page.getByRole("button", { name: "Invite Member" }).click();
  await page.getByLabel("Email").fill(MEMBER.email);
  await page.getByRole("button", { name: "Generate invite link" }).click();
  const link = (await page.locator("code").last().textContent())?.trim() ?? "";
  expect(link).toContain("/invite/");
  // The open dialog traps focus — close it before touching the sidebar.
  await page.keyboard.press("Escape");
  // Account menu in the sidebar: open it, then sign out from the menu.
  await page.getByRole("button", { name: /Account:/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/login");

  await page.goto(link);
  await expect(page.getByText(MEMBER.email)).toBeVisible();
  // One-time name claim at accept — locked afterwards.
  await page.getByLabel("Display name").fill("E2E Member");
  await page.getByLabel("Choose a password").fill(MEMBER.password);
  await page.getByLabel("Confirm password").fill(MEMBER.password);
  await page.getByRole("button", { name: "Set password and join" }).click();
  await expect(page).toHaveURL(`/${orgSlug}/dashboard`);

  // 8. Restricted permissions: no invite UI, no row actions, own keys only.
  // MEMBER was never added to e2e-group: group list is empty for them and
  // the group run stays invisible in UI and API alike.
  await page.goto(`/${orgSlug}/team`);
  await expect(page.getByRole("button", { name: "Invite Member" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("cell", { name: MEMBER.email })).toBeVisible();
  // Claimed name at accept + Active status are visible to the member.
  await expect(page.getByRole("cell", { name: "E2E Member" })).toBeVisible();
  await expect(page.getByText("Active", { exact: true }).first()).toBeVisible();
  await page.goto(`/${orgSlug}/groups`);
  await expect(page.getByText("You are in no groups yet")).toBeVisible();
  await page.goto(`/${orgSlug}/e2e-proj/runs`);
  await expect(page.getByRole("link", { name: "group-run" })).toHaveCount(0);

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
  // Stranger's API view: group list empty, group run a 404.
  const mh = { Cookie: memberCookie };
  const mGroups = await request.get("/api/v1/groups", { headers: mh });
  expect((await mGroups.json()).groups as unknown[]).toHaveLength(0);
  const mRun = await request.get(`/api/v1/runs/${groupRunId}`, {
    headers: mh,
  });
  expect(mRun.status()).toBe(404);

  // 9. Profile: identity, activity heatmap, editable bio, own runs.
  await page.goto(`/${orgSlug}/profile`);
  await expect(page.getByText(MEMBER.email).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: /Activity/ })).toBeVisible();
  await expect(page.getByText("Recent runs")).toBeVisible();
  await page.getByRole("button", { name: "Edit profile" }).click();
  await page.getByLabel("Bio").fill("e2e bio");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("e2e bio")).toBeVisible();

  // The member's own runs (not the admin's) populate Recent runs.
  const mmk = await request.post("/api/v1/runs", {
    headers: { Cookie: memberCookie },
    data: { project: "e2e-proj", name: "member-run" },
  });
  expect(mmk.ok()).toBeTruthy();
  await page.goto(`/${orgSlug}/profile`);
  await expect(page.getByRole("link", { name: "member-run" })).toBeVisible();
  await expect(page.getByRole("link", { name: "run-a-renamed" })).toHaveCount(
    0,
  );

  // 9b. Your activity: personal streaks, grid, and project breakdown.
  await page.goto(`/${orgSlug}/activity`);
  await expect(
    page.getByRole("heading", { name: /Your activity/ }),
  ).toBeVisible();
  await expect(page.getByText("Current streak")).toBeVisible();
  await expect(page.getByText("Contribution grid")).toBeVisible();
  await expect(page.getByText("Top projects")).toBeVisible();
  await expect(page.getByText("Weekday rhythm")).toBeVisible();
  await expect(page.getByText("Monthly trend")).toBeVisible();
  await expect(page.getByText("Records")).toBeVisible();

  // 10. Admin renames the member from the Team row menu (members have no
  // self-service path — the name locked at invite accept).
  await page.getByRole("button", { name: /Account:/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/login");
  await page.getByLabel("Email").fill(ADMIN.email);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(`/${orgSlug}/dashboard`);
  await page.goto(`/${orgSlug}/team`);
  await page
    .getByRole("button", { name: `Actions for ${MEMBER.email}` })
    .click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await page.getByLabel("Display name").fill("E2E Member Renamed");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(
    page.getByRole("cell", { name: "E2E Member Renamed" }),
  ).toBeVisible();

  // 11. Admin hard-deletes the outsider from the Team row menu: confirm
  // dialog, row gone, everyone else stays.
  await page
    .getByRole("button", { name: `Actions for ${OUTSIDER.email}` })
    .click();
  await page.getByRole("menuitem", { name: "Delete…" }).click();
  await expect(page.getByText("Delete account")).toBeVisible();
  await page.getByRole("button", { name: "Delete permanently" }).click();
  await expect(
    page.getByRole("cell", { name: OUTSIDER.email, exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("cell", { name: "E2E Member Renamed" }),
  ).toBeVisible();

  // 11b. Connect card: the deployment's base URL is visible and copyable.
  await page.goto(`/${orgSlug}/settings/keys`);
  await expect(page.getByText("Base URL")).toBeVisible();
  await expect(
    page.getByText("http://127.0.0.1:3100", { exact: true }),
  ).toBeVisible();

  // 12. Viewer role: invite as viewer, accept, read everything, write nothing.
  await page.goto(`/${orgSlug}/team`);
  await page.getByRole("button", { name: "Invite Member" }).click();
  await page.getByLabel("Email").fill(VIEWER.email);
  await page.getByLabel("Role").selectOption("VIEWER");
  await page.getByRole("button", { name: "Generate invite link" }).click();
  const viewerLink =
    (await page.locator("code").last().textContent())?.trim() ?? "";
  expect(viewerLink).toContain("/invite/");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /Account:/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/login");

  await page.goto(viewerLink);
  await page.getByLabel("Display name").fill("E2E Viewer");
  await page.getByLabel("Choose a password").fill(VIEWER.password);
  await page.getByLabel("Confirm password").fill(VIEWER.password);
  await page.getByRole("button", { name: "Set password and join" }).click();
  await expect(page).toHaveURL(`/${orgSlug}/dashboard`);
  // No creation UI anywhere for viewers…
  await expect(page.getByRole("button", { name: "New Project" })).toHaveCount(
    0,
  );
  await page.goto(`/${orgSlug}/team`);
  await expect(page.getByRole("button", { name: "Invite Member" })).toHaveCount(
    0,
  );
  await expect(page.getByText("viewer", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Actions for/ })).toHaveCount(
    0,
  );
  // …but reads work: run detail renders, rename control is gone.
  await page.goto(`/${orgSlug}/e2e-proj/runs/${runIds[0]}`);
  await expect(page.getByRole("tab", { name: "Charts" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Rename run" })).toHaveCount(0);
});
