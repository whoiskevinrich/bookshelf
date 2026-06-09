/**
 * Auth setup — runs once before the e2e project.
 *
 * Signs in via the real login page using the TEST_USER_EMAIL /
 * TEST_USER_PASSWORD env vars (set these in apps/web/.env.test.local).
 * Saves the resulting browser storage (Amplify localStorage tokens + cookies)
 * to .auth/user.json so every subsequent test starts already authenticated.
 */

import { test as setup, expect } from "@playwright/test";

const AUTH_FILE = ".auth/user.json";

setup("authenticate", async ({ page }) => {
  const email = process.env.TEST_USER_EMAIL;
  const password = process.env.TEST_USER_PASSWORD;

  if (!email || !password) {
    throw new Error(
      "TEST_USER_EMAIL and TEST_USER_PASSWORD must be set to run E2E tests. " +
        "Add them to apps/web/.env.test.local (gitignored).",
    );
  }

  await page.goto("/auth/login");

  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');

  // LoginPage redirects to /shelf on success
  await expect(page).toHaveURL(/\/shelf/, { timeout: 20_000 });

  // Persist Amplify localStorage tokens (and any cookies) for the test project
  await page.context().storageState({ path: AUTH_FILE });
});
