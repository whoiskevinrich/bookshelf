/**
 * E2E tests for the book search feature and its auth gate.
 *
 * Auth-gate tests (describe block 1)
 *   Use Playwright's isolated `request` fixture — a fresh APIRequestContext
 *   with no cookies or localStorage, completely separate from the browser
 *   context and its storageState. Any request made here is unauthenticated.
 *
 * Signed-in tests (describe block 2)
 *   Use the `page` fixture, which loads the Amplify session tokens saved by
 *   auth.setup.ts into the browser context via storageState.
 */

import { test, expect } from "@playwright/test";

const API_BASE_URL = (process.env.API_BASE_URL ?? "http://localhost:3001").replace(/\/$/, "");

// ── Auth gate — unauthenticated requests must be rejected ────────────────────

test.describe("Books API — auth gate", () => {
  test("GET /v1/books/search returns 401 without a token", async ({ request }) => {
    const res = await request.get(`${API_BASE_URL}/v1/books/search?q=dune`);
    expect(res.status()).toBe(401);
  });

  test("GET /v1/books/isbn/:isbn returns 401 without a token", async ({ request }) => {
    const res = await request.get(`${API_BASE_URL}/v1/books/isbn/9780441013593`);
    expect(res.status()).toBe(401);
  });

  test("GET /v1/books/asin/:asin returns 401 without a token", async ({ request }) => {
    const res = await request.get(`${API_BASE_URL}/v1/books/asin/B000FC1DQ4`);
    expect(res.status()).toBe(401);
  });
});

// ── Signed-in search — full browser flow with a real Cognito session ─────────

test.describe("Book search — signed in", () => {
  test("returns results for a text query", async ({ page }) => {
    await page.goto("/shelf");

    // ShelfPage renders BookSearch inside a collapsible panel
    await page.getByRole("button", { name: "Add a book" }).click();

    const searchInput = page.getByPlaceholder("Search by title, author, or paste an ISBN…");
    await expect(searchInput).toBeVisible();
    await searchInput.fill("Dune Herbert");

    // BookSearch debounces 400 ms then calls GET /v1/books/search.
    // Wait for at least one result card — identified by its "Add Owned" CTA.
    await expect(page.getByRole("button", { name: "Add Owned" }).first()).toBeVisible({
      timeout: 15_000,
    });

    // Confirm no error state is shown in the live region
    const status = page.getByRole("status");
    await expect(status).not.toContainText("failed");
    await expect(status).not.toContainText("Search failed");
  });
});
