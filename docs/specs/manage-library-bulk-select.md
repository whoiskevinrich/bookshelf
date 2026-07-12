# Spec: "Manage Library" Bulk-Select Mode

**Status**: Draft
**Date**: 2026-07-12
**Owner**: Solo developer
**Jira**: [BOOKSHELF-59](https://whoiskevinrich.atlassian.net/browse/BOOKSHELF-59) (epic BOOKSHELF-62 Feedback)
**Related**: `docs/decisions.md` row "Bulk 'Manage Library' (BOOKSHELF-59)" (architecture decision — client-side fan-out, no batch API), `docs/decisions.md` row "Shelf card actions" (BOOKSHELF-48 — hover-reveal precedent this mode must not repeat), `docs/specs/multiple-copies.md` (forward reference: bulk delete is the sanctioned removal path)

## Problem

User feedback (2026-07-01, rank 12): _"Need Manage Library to allow quick select and delete of books. Shouldn't be too easy to delete books from homepage."_

Every shelf action today is per-book, reached one card at a time via `ShelfBookCard`'s hover/focus overlay. There's no way to delete, move, or tag more than one book without repeating the same steps per book — tedious for a user cleaning up a large wishlist or re-tagging a batch of books. At the same time, BOOKSHELF-48 already established that destructive actions must never be a stray tap away; a bulk mode has to confirm explicitly and stay off by default.

## Scope

**In scope**: an explicit, opt-in "Manage" mode on the shelf page. While active, every rendered `ShelfBookCard` grows an always-visible selection checkbox; a bulk action bar offers delete (confirmed with a count), move owned↔wishlist, add-to-shelf, and add-tag, each applied to the current selection via client-side fan-out over the existing single-item routes. Partial failures are reported per-item with a retry-failed-only action.

**Out of scope**: new batch API endpoints (decided — see `docs/decisions.md`); bulk _removal_ from a shelf or bulk tag _removal_ (v1 covers the additive/common cases from the ticket; removal stays per-book); selecting across paginated pages not yet loaded (selection only covers loaded entries, consistent with existing client-side search/author filtering).

## Design

### Entering/exiting Manage mode

A "Manage" button in the shelf page header toggles `manageMode`. While active:

- The header's other actions (+ New shelf / Scan / Add a book) are replaced by a single "Done" button — this is the "clear visual state change" the acceptance criteria calls for, and it removes the temptation to mix adding books with bulk-editing them.
- A sticky `BulkActionBar` renders above the book grid showing the selection count, Select-all/Clear, and the bulk actions (disabled at 0 selected).
- Exiting Manage mode (Done) clears the selection.

### Selection

Selection state (`Set<string>` of ISBNs) lives in `ShelfPage`. Each `ShelfBookCard` gets `manageMode`, `selected`, and `onToggleSelect` props:

- A checkbox renders in the card's top-left corner whenever `manageMode` is true — **always visible**, not hover-revealed, per the design system's no-hover-only-affordances rule and the ticket's own keyboard/touch requirement. This is a deliberate departure from BOOKSHELF-48's hover-only precedent for the _existing_ per-card overlay: that overlay stays hover/focus-only and is hidden entirely while Manage mode is active, so the two affordances never compete for the same tap.
- Clicking anywhere on the card (cover or title) toggles selection instead of navigating to Book Details, so touch users aren't forced to hit a small checkbox target.
- A selected card gets a visible ring in addition to the checked checkbox (shape + state, not color alone).

"Select all" selects every entry in the currently active view (search results / author filter / reading list / facet-tag filter / the full library in the default grouped view) — the same entry set already computed for that view, not a separate "everything in the account" scope.

### Bulk actions

All four fan out client-side over the existing single-item routes (`docs/decisions.md`), via `Promise.allSettled`:

| Action                   | Per-item call                                         | Confirmation                                                                                                                              |
| ------------------------ | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Delete                   | `DELETE /v1/shelf/:isbn` (`removeFromShelf`)          | `ConfirmDialog`, "Delete N books?"                                                                                                        |
| Move to Owned / Wishlist | `PATCH /v1/shelf/:isbn` (`updateShelfStatus`)         | none — reversible, matches existing per-card "Mark as Owned"                                                                              |
| Add to shelf             | `POST /v1/shelves/:id/books/:isbn` (`addBookToShelf`) | none — additive                                                                                                                           |
| Add tag                  | `PATCH /v1/shelf/:isbn/tags` (`updateShelfTags`)      | none — additive; computed client-side by merging the new tag into each entry's existing `tags` (the endpoint replaces, it doesn't append) |

After a batch settles, a `Callout` reports "`X` of `N` updated" plus, if any failed, "`Y` failed — Retry failed"; retry re-runs the same operation against only the failed ISBNs. Query cache invalidation (`["shelf"]`, `["shelves"]`) happens once per batch on settle rather than per item — simpler than per-item optimistic rollback and still satisfies "handle partial failures gracefully."

### Accessibility

- Checkboxes are native `<input type="checkbox">`, individually labelled ("Select \"_title_\"") — full keyboard operability for free.
- The action bar uses `<Button>` throughout; destructive delete uses the `danger` variant via `ConfirmDialog`, matching every other destructive confirm in the app.
- No hover-only affordance is introduced; Manage mode's checkbox and action bar are equally usable with a mouse, keyboard, or touch.

## Acceptance criteria (from the ticket)

- [x] Enter/exit Manage mode with a clear visual state change — header swap + sticky action bar.
- [x] Bulk delete always confirms with an explicit count.
- [x] Bulk operations handle partial failures gracefully — per-item results, retry-failed action.
- [x] Keyboard and touch accessible; no hover-only affordances.
- [x] API: client-side fan-out over existing per-book routes (decided in `docs/decisions.md`).
