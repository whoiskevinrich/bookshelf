/**
 * E2E — book detail view (#82 / ADR-019 surface).
 *
 * Adds a book, opens its /book/:isbn detail page, and exercises the "Your copy"
 * editor: owned/want, reading status, tags, and notes (save-on-blur, verified to
 * survive a reload). Also covers the not-found state for a book not on the shelf.
 *
 * Prefers the ADR-019 attributes (owned / want / readingStatus / tags) — never the
 * deprecated `status` field, which is being removed by the stabilize block.
 */

import { test, expect } from "@playwright/test";
import { addBookByIsbn, cardByIsbn, removeBookByIsbn } from "./helpers";

test.describe.configure({ mode: "serial" });

const HYPERION = "9780553283686";
// A valid ISBN-13 we never add — the detail route returns 4xx → the not-found state.
const NOT_ON_SHELF = "9780261103573"; // The Fellowship of the Ring

test.describe("Book detail — your copy", () => {
  test.beforeEach(async ({ page }) => {
    await removeBookByIsbn(page, HYPERION);
  });

  test.afterEach(async ({ page }) => {
    await removeBookByIsbn(page, HYPERION);
  });

  test("edit owned/want, reading status, tags, and notes from the detail page", async ({
    page,
  }) => {
    await addBookByIsbn(page, HYPERION, "owned");

    // Navigate via the card's title link (the explicit affordance), not a raw goto.
    await cardByIsbn(page, HYPERION).getByRole("link").first().click();
    await expect(page).toHaveURL(new RegExp(`/book/${HYPERION}`));

    // The "Your copy" panel confirms the editor loaded.
    await expect(page.getByRole("heading", { name: "Your copy" })).toBeVisible();

    // ── Owned / Want (mutually exclusive radiogroup) ─────────────────────────
    const ownership = page.getByRole("radiogroup", { name: "Owned or wishlist" });
    await expect(ownership.getByRole("radio", { name: "Owned" })).toBeChecked();
    await ownership.getByRole("radio", { name: "Want" }).click();
    await expect(ownership.getByRole("radio", { name: "Want" })).toBeChecked();
    await expect(ownership.getByRole("radio", { name: "Owned" })).not.toBeChecked();

    // ── Reading status ───────────────────────────────────────────────────────
    const reading = page.getByRole("radiogroup", { name: "Reading status" });
    await reading.getByRole("radio", { name: "Reading" }).click();
    await expect(reading.getByRole("radio", { name: "Reading" })).toBeChecked();

    // ── Tags ─────────────────────────────────────────────────────────────────
    const tag = `e2e-${Date.now()}`;
    await page.getByLabel("Add a tag").fill(tag);
    await page.getByRole("button", { name: "Add", exact: true }).click();
    const tagChip = page.getByText(tag, { exact: true });
    await expect(tagChip).toBeVisible();
    // Remove it again.
    await page.getByRole("button", { name: `Remove tag ${tag}` }).click();
    await expect(page.getByText(tag, { exact: true })).toHaveCount(0);

    // ── Notes (save on blur, persisted) ──────────────────────────────────────
    const notes = `e2e note ${Date.now()}`;
    const notesField = page.locator("#book-notes");
    await notesField.fill(notes);
    await notesField.blur();

    // Reload and confirm the note round-tripped through the API.
    await page.reload();
    await expect(page.locator("#book-notes")).toHaveValue(notes, { timeout: 15_000 });
  });

  test("shows a not-found state for a book that isn't on the shelf", async ({ page }) => {
    await page.goto(`/book/${NOT_ON_SHELF}`);
    await expect(page.getByText("We couldn't find this book on your shelf.")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("button", { name: "Back to My Library" })).toBeVisible();
  });
});
