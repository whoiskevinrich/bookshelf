/**
 * E2E — shelf happy path.
 *
 * Covers the core library loop end to end against the real dev stack:
 *   search → add → see it on the shelf → move (want → owned) → remove.
 *
 * Auth comes from auth.setup.ts (storageState), so these start signed in as the
 * shared QA user. Each test owns a distinct ISBN and cleans up after itself; see
 * helpers.ts for why the assertions are presence-based, not count-based.
 */

import { test, expect } from "@playwright/test";
import { addBookByIsbn, cardByIsbn, removeBookByIsbn } from "./helpers";

// One shared QA account → serialize within this file so the two tests never race
// on the same shelf. Distinct ISBNs keep us isolated from other spec files.
test.describe.configure({ mode: "serial" });

const DUNE = "9780441013593"; // search → add Owned → remove
const NEUROMANCER = "9780441569595"; // add Want → mark Owned → remove

test.describe("Shelf — happy path", () => {
  test.beforeEach(async ({ page }) => {
    // Defensive reset in case a previous run left either book behind.
    await removeBookByIsbn(page, DUNE);
    await removeBookByIsbn(page, NEUROMANCER);
  });

  test.afterEach(async ({ page }) => {
    await removeBookByIsbn(page, DUNE);
    await removeBookByIsbn(page, NEUROMANCER);
  });

  test("search for a book, add it as Owned, then remove it", async ({ page }) => {
    await addBookByIsbn(page, DUNE, "owned");

    const card = cardByIsbn(page, DUNE);
    await expect(card).toBeVisible();
    // Owned state is communicated by an "Owned" pill (label + icon, not color alone).
    await expect(card.getByText("Owned", { exact: true })).toBeVisible();

    await removeBookByIsbn(page, DUNE);
    await expect(cardByIsbn(page, DUNE)).toHaveCount(0);
  });

  test("add a book to the wishlist, then move it to Owned", async ({ page }) => {
    await addBookByIsbn(page, NEUROMANCER, "want");

    const card = cardByIsbn(page, NEUROMANCER);
    await expect(card.getByText("Want", { exact: true })).toBeVisible();

    // The "Mark as Owned" overlay action only renders for wishlist books. Reveal
    // the hover overlay, then promote it.
    await card.hover();
    await card.getByRole("button", { name: "Mark as Owned" }).click();

    // After the optimistic move, the pill flips from Want → Owned.
    await expect(card.getByText("Owned", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(card.getByText("Want", { exact: true })).toHaveCount(0);
  });
});
