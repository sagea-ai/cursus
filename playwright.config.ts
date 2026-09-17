import { defineConfig, devices } from "@playwright/test";

// E2E skeleton (PRD §10.2). The full journey suite lands in M2:
// login → create project → (SDK, scripted) log a run → view dashboard →
// compare two runs → invite a member → restricted-permission login.
// M0 keeps the runner configured and green with zero specs so CI has the
// gate from commit one.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: process.env["BASE_URL"] ?? "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: undefined, // CI starts the app + DB explicitly (see workflow).
});
