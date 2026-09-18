import { defineConfig, devices } from "@playwright/test";

// E2E: critical user journeys against a real instance + throwaway database
// (PRD §10.2). Local: docker compose up -d db && migrate, build once, then
// E2E_DATABASE_URL=... npx playwright test. CI runs the e2e job (see
// .github/workflows/ci.yml). Never point BASE_URL at a shared/dev database.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 2 : 0,
  reporter: "list",
  timeout: 60_000,
  use: {
    baseURL: process.env["BASE_URL"] ?? "http://127.0.0.1:3100",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: process.env["E2E_NO_SERVER"]
    ? undefined
    : {
        command: "npm run start -- --port 3100",
        url: "http://127.0.0.1:3100/api/v1/health",
        reuseExistingServer: false,
        timeout: 120_000,
        env: {
          ...(process.env["E2E_DATABASE_URL"]
            ? { DATABASE_URL: process.env["E2E_DATABASE_URL"] as string }
            : {}),
          ...(process.env["BOOTSTRAP_ADMIN_EMAIL"]
            ? {
                BOOTSTRAP_ADMIN_EMAIL: process.env[
                  "BOOTSTRAP_ADMIN_EMAIL"
                ] as string,
              }
            : {}),
          ...(process.env["BOOTSTRAP_ORG_NAME"]
            ? {
                BOOTSTRAP_ORG_NAME: process.env["BOOTSTRAP_ORG_NAME"] as string,
              }
            : {}),
        },
      },
});
