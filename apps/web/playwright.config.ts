import { readFileSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

/**
 * Required env vars:
 *   APP_BASE_URL       Web app root (default: http://localhost:3000)
 *   API_BASE_URL       Hono API root  (default: http://localhost:3001)
 *   TEST_USER_EMAIL    Cognito test-user email  (required for signed-in tests)
 *   TEST_USER_PASSWORD Cognito test-user password (required for signed-in tests)
 *
 * For local runs, copy .env.test.local.example → apps/web/.env.test.local
 * (gitignored) and fill it in — it is auto-loaded below. In CI, set the same
 * names as repository secrets instead. These are read Node-side only and are NOT
 * VITE_-prefixed, so they never reach the browser bundle.
 */

/**
 * Load apps/web/.env.test.local into process.env. Playwright does not auto-load
 * dotenv files, so without this the documented TEST_USER_* vars would never reach
 * the setup project. Already-set vars win, so CI-provided secrets are never
 * overridden. Zero-dependency by design — keeps the e2e setup self-contained.
 */
function loadTestEnv(relPath: string): void {
  let contents: string;
  try {
    contents = readFileSync(new URL(relPath, import.meta.url), "utf8");
  } catch {
    return; // No local file — rely on the ambient environment (e.g. CI secrets).
  }
  for (const rawLine of contents.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!key || key in process.env) continue;
    let value = line.slice(eq + 1).trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (quoted) value = value.slice(1, -1);
    process.env[key] = value;
  }
}

loadTestEnv("./.env.test.local");

const APP_BASE_URL = (process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const API_BASE_URL = (process.env.API_BASE_URL ?? "http://localhost:3001").replace(/\/$/, "");

export default defineConfig({
  testDir: "./e2e",
  // All signed-in specs mutate ONE shared QA account's shelf, so they must run
  // serially — parallel workers race on the same data (a book one test adds shows
  // up in another; a cleanup empties the shelf mid-add). One worker, no in-file
  // parallelism. The suite is small, so the wall-clock cost is a few dozen seconds.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  use: {
    baseURL: APP_BASE_URL,
    trace: "on-first-retry",
  },

  /**
   * Boot the API + web dev servers for the run. Locally, `reuseExistingServer`
   * latches onto the servers you already have up (from `/dev`) instead of starting
   * duplicates; in CI it always starts fresh. Both talk to the REAL dev backend —
   * the API needs AWS credentials in the environment (OIDC in CI, `assume` locally)
   * and both read their `.env.local` for Cognito/table config (no mock auth).
   */
  webServer: [
    {
      command: "pnpm --filter @bookshelf/api dev",
      url: `${API_BASE_URL}/health`,
      reuseExistingServer: !process.env.CI,
      stdout: "pipe",
      timeout: 90_000,
    },
    {
      command: "pnpm --filter @bookshelf/web dev",
      url: APP_BASE_URL,
      reuseExistingServer: !process.env.CI,
      stdout: "pipe",
      timeout: 90_000,
    },
  ],

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
