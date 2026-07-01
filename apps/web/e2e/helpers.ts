/**
 * Shared helpers for the signed-in E2E specs.
 *
 * These run against the REAL dev Cognito + DynamoDB (no mock auth — see CLAUDE.md),
 * using the single shared QA user. Because every spec mutates that one account's
 * shelf, the helpers are written to be idempotent and self-cleaning:
 *   - each spec owns a DISTINCT ISBN so parallel spec files never collide;
 *   - assertions are presence/absence based (never exact counts), so a book left
 *     by another spec can't make a passing test fail;
 *   - removeBookByIsbn is safe to call when the book is absent, so it doubles as
 *     both before-state reset and after-test cleanup.
 */

import { type Page, type Locator, expect } from "@playwright/test";

/** Escape a string for safe interpolation into a RegExp. */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Locate the shelf card for a given ISBN.
 *
 * The card root is `div.group/card` (a Tailwind group name — the `/` is escaped
 * for the CSS selector). We scope to the one card whose title link points at this
 * book's detail route (`/book/<isbn>`), which is the most stable per-book anchor
 * on the card — far steadier than the title text, which can repeat across editions.
 */
export function cardByIsbn(page: Page, isbn: string): Locator {
  return page.locator("div.group\\/card").filter({ has: page.locator(`a[href="/book/${isbn}"]`) });
}

/**
 * Wait for the shelf grid to finish loading: the header shell is up AND the
 * loading skeleton is gone. Presence checks (does book X exist? which smart
 * shelves exist?) MUST wait for this — reading the DOM on a still-loading page
 * misreads a not-yet-rendered grid as empty, which silently skips cleanup and
 * lets residue pile up on the shared QA account.
 */
async function waitShelfSettled(page: Page): Promise<void> {
  const addToggle = page.getByRole("button", { name: "Add a book" });
  const emptyStateCta = page.getByRole("button", { name: /Add your first book/ });
  await expect(addToggle.or(emptyStateCta).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("status", { name: "Loading books" })).toHaveCount(0, {
    timeout: 15_000,
  });
}

/** Navigate to /shelf and wait for the grid to settle. */
async function gotoShelfLoaded(page: Page): Promise<void> {
  await page.goto("/shelf");
  await waitShelfSettled(page);
}

/** Open the BookSearch add panel, handling both the normal and empty-shelf layouts. */
async function openAddPanel(page: Page): Promise<Locator> {
  const addToggle = page.getByRole("button", { name: "Add a book" });
  const emptyStateCta = page.getByRole("button", { name: /Add your first book/ });

  if (await addToggle.count()) {
    await addToggle.first().click();
  } else {
    // Zero-book shelf renders ShelfEmptyState instead of the header toggle.
    await emptyStateCta.first().click();
  }

  const search = page.getByPlaceholder("Search by title, author, or paste an ISBN…");
  await expect(search).toBeVisible({ timeout: 15_000 });
  return search;
}

/**
 * Add a book to the shelf by pasting its ISBN into BookSearch and clicking the
 * Owned or Wishlist CTA. Pasting an ISBN resolves to a single result, so the add
 * is deterministic.
 *
 * Removes any pre-existing copy first (a crashed prior run can leave this book on
 * the shared QA account with the wrong status), so the add always creates a fresh
 * entry with the intended state rather than hitting a 409, then asserts the
 * matching Owned/Want pill so a silent "already exists" can't slip through.
 */
export async function addBookByIsbn(
  page: Page,
  isbn: string,
  status: "owned" | "want" = "owned",
): Promise<void> {
  await removeBookByIsbn(page, isbn);

  await gotoShelfLoaded(page);
  const search = await openAddPanel(page);
  await search.fill(isbn);

  const cta =
    status === "owned"
      ? page.getByRole("button", { name: "Add Owned" })
      : page.getByRole("button", { name: "Add to Wishlist" });

  // BookSearch debounces ~400ms then calls GET /v1/books/isbn/:isbn (real upstream).
  await expect(cta.first()).toBeVisible({ timeout: 15_000 });
  await cta.first().click();

  const card = cardByIsbn(page, isbn);
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card.getByText(status === "owned" ? "Owned" : "Want", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
}

/**
 * Remove a book from the shelf if present. Safe to call when the book is absent,
 * so it works as both a pre-test reset and post-test cleanup.
 */
export async function removeBookByIsbn(page: Page, isbn: string): Promise<void> {
  await gotoShelfLoaded(page);
  const card = cardByIsbn(page, isbn).first();
  if ((await card.count()) === 0) return;

  // The action overlay is hover-revealed (opacity-0 + pointer-events-none until
  // the card is hovered), so reveal it before clicking the trash action.
  await card.hover();
  await card.getByRole("button", { name: "Remove from library" }).click();
  await expect(cardByIsbn(page, isbn)).toHaveCount(0, { timeout: 15_000 });

  // The card disappears optimistically before the DELETE commits server-side.
  // Reload and re-settle to confirm the delete is durable, so a following add
  // can't race the in-flight DELETE and hit a 409 "already exists".
  await page.reload();
  await waitShelfSettled(page);
  await expect(cardByIsbn(page, isbn)).toHaveCount(0, { timeout: 15_000 });
}

/**
 * Delete every smart shelf whose name starts with the E2E prefix (`e2e-`). Sweeps
 * up strays left by a crashed run in addition to the current test's shelf, keeping
 * the shared QA account tidy across nightly runs.
 */
export async function deleteE2ESmartShelves(page: Page): Promise<void> {
  await gotoShelfLoaded(page);
  const delButtons = page.getByRole("button", { name: /^Delete smart shelf e2e-/ });
  // Delete one at a time (the group re-renders after each); guard against a stuck
  // loop if a delete ever fails to remove its chip.
  for (let guard = 0; guard < 50; guard++) {
    const count = await delButtons.count();
    if (count === 0) return;
    await delButtons.first().click();
    await confirmSmartShelfDelete(page);
    await expect(delButtons).toHaveCount(count - 1, { timeout: 15_000 });
  }
}

/**
 * Confirm the smart-shelf delete dialog. Clicking a chip's X opens a ConfirmDialog
 * (confirm button labeled "Delete smart shelf") — the chip isn't removed until this
 * is confirmed. Scoped to the dialog so it never matches a chip's own delete button.
 */
export async function confirmSmartShelfDelete(page: Page): Promise<void> {
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete smart shelf", exact: true })
    .click();
}
