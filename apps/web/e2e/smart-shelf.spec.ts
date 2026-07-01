/**
 * E2E — smart shelves & facet filtering (#82 / ADR-019 auto-shelves).
 *
 * Adds an owned book, filters the shelf to the Owned facet, saves that filter as a
 * smart shelf, applies it, then deletes it. Smart-shelf book counts are never
 * asserted (other specs' books share this QA account); we assert by the smart
 * shelf's unique name instead.
 */

import { test, expect } from "@playwright/test";
import {
  addBookByIsbn,
  cardByIsbn,
  removeBookByIsbn,
  deleteE2ESmartShelves,
  confirmSmartShelfDelete,
  escapeRegExp,
} from "./helpers";

test.describe.configure({ mode: "serial" });

const LEFT_HAND = "9780441478125"; // The Left Hand of Darkness

test.describe("Smart shelves", () => {
  // Unique per run so retries never collide on the name; the `e2e-` prefix lets the
  // sweep clean up strays from any crashed run.
  const shelfName = `e2e-owned-${Date.now()}`;

  test.beforeEach(async ({ page }) => {
    await deleteE2ESmartShelves(page);
  });

  test.afterEach(async ({ page }) => {
    await deleteE2ESmartShelves(page);
    await removeBookByIsbn(page, LEFT_HAND);
  });

  test("save the Owned filter as a smart shelf, apply it, then delete it", async ({ page }) => {
    await addBookByIsbn(page, LEFT_HAND, "owned");

    // Filter to Owned via the facet bar (scoped so we hit the facet button, not the
    // active-filter chip of the same label).
    await page
      .getByRole("group", { name: "Filter by status" })
      .getByRole("button", { name: "Owned" })
      .click();

    // Save the active filter as a smart shelf.
    await page.getByRole("button", { name: "Save as smart shelf" }).click();
    const saveForm = page.locator("form", { has: page.locator("#smart-shelf-name") });
    await expect(saveForm.locator("#smart-shelf-name")).toBeVisible();
    await saveForm.locator("#smart-shelf-name").fill(shelfName);
    await saveForm.getByRole("button", { name: "Save", exact: true }).click();
    // The form closes on a successful save.
    await expect(saveForm).toHaveCount(0, { timeout: 15_000 });

    // Smart-shelf chips only render in the UNFILTERED view (the filtered flat-grid
    // has no SmartShelvesGroup), so clear the active filter to reveal the new chip.
    await page.getByRole("button", { name: "Clear" }).click();

    // The new smart-shelf chip appears (count is dynamic, so match on the name).
    const applyChip = page.getByRole("button", {
      name: new RegExp(`^Open smart shelf ${escapeRegExp(shelfName)} `),
    });
    await expect(applyChip).toBeVisible({ timeout: 15_000 });

    // Applying it re-enters the filtered view; the owned book shows.
    await applyChip.click();
    await expect(cardByIsbn(page, LEFT_HAND)).toBeVisible({ timeout: 15_000 });

    // Delete needs the chip again, which lives in the unfiltered view — clear the
    // applied filter, then delete via the confirm dialog.
    await page.getByRole("button", { name: "Clear" }).click();
    const deleteChip = page.getByRole("button", { name: `Delete smart shelf ${shelfName}` });
    await deleteChip.click();
    await confirmSmartShelfDelete(page);
    await expect(deleteChip).toHaveCount(0, { timeout: 15_000 });
  });
});
