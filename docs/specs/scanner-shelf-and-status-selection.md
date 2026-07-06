# Spec: Scanner Remembers a Shelf, Not Just Owned/Wishlist (BOOKSHELF-85)

**Status**: Implemented (PR pending merge)
**Date**: 2026-07-05
**Jira**: BOOKSHELF-85 — labels `design-ui`, `devx`, `needs-spec`, `qa-followup`, `user-feedback`, `whats-new`
**Related**: `docs/specs/scanner-destination-memory.md` (BOOKSHELF-58, ships the destination chip this
extends), `docs/adrs/026-scanner-destination-memory.md` (explicitly defers named-shelf targets to
BOOKSHELF-27), BOOKSHELF-27 (separate: adding books to a populated shelf from `SingleShelfPage`)

## Problem

Testing BOOKSHELF-58 uncovered a hidden need (per the ticket): the scanner's remembered
destination is only **Owned vs. Wishlist** (`ShelfStatus`). The app also has a completely
separate **named/custom shelf** concept (`Shelf`, `ShelfEntry`, `useShelves()` —
`apps/web/src/hooks/useShelves.ts`) that a book can additionally belong to, independent of its
owned/want status — see `ShelvesPanel` on `BookDetailPage.tsx:230` and the per-card `ShelfPicker`
in `ShelfBookCard.tsx:229`. Today the only way to file a scanned book onto a named shelf is to
scan it in, then separately open the book and check a shelf box. The scanner should let the user
pick a shelf destination too, and remember it like it already remembers status.

**Not the same as BOOKSHELF-27.** BOOKSHELF-27 is about `SingleShelfPage`'s non-empty state
having no "add books" affordance at all. This spec is about the **scanner** gaining a shelf
destination, independent of that page.

## Scope decision

Per product discussion: **single shelf (or none) per scan session**, not a multi-select
checklist. This mirrors BOOKSHELF-58's exact model (one remembered value, changed with one tap)
rather than adopting the multi-select `ShelfPicker` checkbox pattern from `ShelfBookCard`/
`BookDetailPage`. A scanned book can land on **at most one** named shelf per scan (plus its
owned/want status); adding to a second shelf still requires the existing per-book picker.

## Goals

- Add a second remembered scanner preference: the target named shelf (or "No shelf").
- Extend the existing destination chip (`DestinationControl`, `ScanModal.tsx:912`) so both
  **status** (Owned/Wishlist) and **shelf** are visible and changeable from the same one-tap
  control — no second floating chip competing for the same screen space.
- Auto-add and confirm-mode adds both apply the remembered shelf, in addition to status.
- Gracefully handle a remembered shelf that's since been renamed (fine, name is looked up live
  by id) or deleted (falls back to "No shelf" — never errors or silently targets the wrong shelf).
- No backend, CDK, or DynamoDB changes — `addBookToShelf` already exists
  (`useAddBookToShelf()` in `useShelves.ts:72`); this is purely a client-side scanner UX change.

## Non-goals

- Multi-shelf selection in the scanner (explicit scope decision above).
- Creating a new shelf from within the scanner — only existing shelves are selectable.
- Changing `SingleShelfPage`'s non-empty add-books affordance (BOOKSHELF-27, separate ticket).
- Cross-device sync of the remembered shelf (client-only `localStorage`, consistent with the rest
  of `ScannerPreferencesContext`).
- Reordering/renaming shelves from the scanner.

## Design

### 1. New scanner preference — `scanShelfId`

Add to `ScannerPreferencesContext` (`apps/web/src/context/ScannerPreferencesContext.tsx`):

| Preference        | Values                    | Default                 | localStorage key      |
| ----------------- | ------------------------- | ----------------------- | --------------------- |
| **`scanShelfId`** | shelf id string \| `null` | **`null`** ("No shelf") | **`scanner:shelfId`** |

- Unlike `scanDestination`, this can't be validated against a fixed enum with `memberOf` — a
  shelf id is only valid if it still exists. `useLocalStorage`'s `parse` guard just checks it's a
  non-empty string (or `null`); the _existence_ check happens at render time (see below), not at
  storage-read time, since the shelves list isn't available inside the context provider.
- Default `null` ("No shelf") preserves current behavior for every existing user on first load.

### 2. Shelf existence guard (deleted/renamed shelves)

`DestinationControl`'s consumer (`ScanModal`) already has `useShelves()` available via the same
data layer `BookDetailPage` uses. When rendering and when committing an add:

- If `scanShelfId` is set but no shelf in `useShelves().data` has that id, treat it as `null`
  ("No shelf") for that render/commit — **do not** auto-clear the stored preference (the shelf
  list may just be mid-fetch; clearing on a loading-state false-negative would silently forget
  the user's choice). Only the popover's explicit "No shelf" selection writes `null`.
- Renames need no special handling — the chip always looks up the current name by id.

### 3. Chip UI — extend `DestinationControl`, don't add a second chip

The popover opened by the existing chip (`ScanModal.tsx:967-987`) gains a second section below
the Owned/Wishlist rows:

```
┌─────────────────────────────┐
│ ● Owned                     │
│ ○ Wishlist                  │
├─────────────────────────────┤
│ Shelf                       │
│ ○ No shelf                  │
│ ● Sci-Fi                    │
│ ○ To Read Next              │
│ ○ Book Club                 │
└─────────────────────────────┘
```

- Reuses the existing `DestinationOption` row component (icon + label + selected state) for each
  shelf row, with a plain `BookmarkIcon`-style placeholder icon (shelves have no per-shelf icon
  today) and a small "Shelf" section label between the two groups (a `<div>` heading, not a
  `role="separator"`, matching the plain divider style already used at line 979).
- The trigger button's label extends to reflect the shelf when one is set: **"Adding to Owned ·
  Sci-Fi"** (dot-separated), or just **"Adding to Owned"** when shelf is "No shelf" — no layout
  change needed for the common case.
- If `useShelves()` has zero shelves (new user, nothing created yet), the Shelf section is omitted
  entirely rather than showing an empty list — nothing to pick from.
- Same interaction model as today: tap a row → both status and shelf can be changed from the same
  open popover; each selection updates its own preference and can independently stay open or
  close (closing on selection matches today's exactly-one-value-changes-per-tap flow, so selecting
  a shelf closes the popover just like selecting a status does today).
- Accessibility: the two groups render as two `role="menu"` sections (or one menu with a visually
  and programmatically separated group via `role="group"` + `aria-label="Shelf"`), keeping today's
  `aria-live="polite"` announcement, extended to mention both when relevant: "Adding to Owned and
  Sci-Fi" / "Adding to Owned, no shelf".

### 4. Commit path — additive, not exclusive

Shelf membership is **additive** to status, not an alternative like Owned vs. Wishlist is. Both
confirm-sheet buttons ("Add owned" / "Add to wishlist") and auto-add already call `commitAdd`
(`ScanModal.tsx:166`); extend it to also call `useAddBookToShelf()`'s mutation when `scanShelfId`
resolves to a real shelf:

- Sequence in `commitAdd`: after `addMutation.mutateAsync({ isbn, status, ...book })` succeeds,
  if a valid shelf is selected, `await addToShelfMutation.mutateAsync({ shelfId, isbn })`. A
  failure here is reported the same way as today's add failure (`setError`/flash-pill "duplicate"
  path already exists for `isConflictError` — being on a shelf twice isn't an error case the API
  needs to guard since `ShelfBookCard`'s checkbox model already treats it as idempotent add).
- Applies identically whichever button/path triggered the add (both confirm buttons, "Add anyway"
  in `ManualPanel`, and `autoAdd`) — shelf membership tracks the remembered shelf regardless of
  which status button was tapped, since shelf and status are orthogonal per the additive model
  above.

### 5. Analytics (optional, nice-to-have)

A `scan_shelf_changed` event mirroring the optional `scan_destination_changed` event from
BOOKSHELF-58 — add to both the client `AnalyticsEvent` union and server `ALLOWED_EVENTS`
allowlist per ADR-016 if implemented. Not required for acceptance.

## Acceptance criteria

- [ ] The destination chip's popover shows a Shelf section listing all the user's named shelves
      plus "No shelf", below the existing Owned/Wishlist rows.
- [ ] Selecting a shelf persists it (`scanner:shelfId`) and the chip label reflects it (e.g.
      "Adding to Owned · Sci-Fi").
- [ ] A scanned book committed via any path (confirm buttons, "Add anyway", auto-add) is added to
      the remembered shelf, in addition to its owned/want status.
- [ ] If the remembered shelf has since been deleted, the scanner behaves as "No shelf" (status
      still applies) without erroring, and the popover offers to pick a new one.
- [ ] A user with zero shelves sees no Shelf section and scanner behavior is unchanged from today.
- [ ] No backend, CDK, or DynamoDB schema changes — reuses `useAddBookToShelf()`.

## Test impact

`ScanModal.test.tsx`: chip renders shelf rows from `useShelves()`; selecting a shelf persists and
relabels the chip; `commitAdd` calls the shelf-add mutation when a shelf is selected across all
three entry points (confirm, add-anyway, auto-add); deleted-shelf fallback doesn't throw.
`ScannerPreferencesContext` tests: `scanShelfId` default `null`, round-trips through
`localStorage`.

## Out of scope / follow-ups

- Multi-shelf selection (explicit scope decision).
- BOOKSHELF-27's `SingleShelfPage` add-books affordance — unrelated, separate ticket.
- Creating shelves from the scanner.
