import { defineConfig, devices } from "@playwright/test";

/**
 * Required env vars:
 *   APP_BASE_URL       Web app root (default: http://localhost:3000)
 *   API_BASE_URL       Hono API root  (default: http://localhost:3001)
 *   TEST_USER_EMAIL    Cognito test-user email  (required for signed-in tests)
 *   TEST_USER_PASSWORD Cognito test-user password (required for signed-in tests)
 *
 * Store these in apps/web/.env.test.local (gitignored) for local runs.
 */

const APP_BASE_URL = (process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  use: {
    baseURL: APP_BASE_URL,
    trace: "on-first-retry",
  },

  projects: [
    // 1. Sign in once via the real login page; saves Amplify localStorage tokens
    //    to .auth/user.json so the e2e project doesn't re-authenticate per test.
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },

    // 2. All E2E tests.
    //    - Auth-gate tests use the `request` fixture (no browser context, no
    //      storageState) so they always send unauthenticated requests.
    //    - Browser tests use the `page` fixture, which loads the storageState
    //      written by the setup project (Amplify session via localStorage).
    {
      name: "e2e",
      use: {
        ...devices["Desktop Chrome"],
        storageState: ".auth/user.json",
      },
      dependencies: ["setup"],
      testIgnore: /auth\.setup\.ts/,
    },
  ],
});
