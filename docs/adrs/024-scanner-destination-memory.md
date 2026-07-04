# ADR-024: Scanner Destination Memory

**Status**: Accepted
**Date**: 2026-07-04
**Deciders**: Solo developer
**Related**: ADR-014 (mobile barcode scanning), ADR-021 (Wishlist terminology / `want` wire value), ADR-016 (client analytics events), ADR-019 (auto-shelves are computed rules, no stored membership); `docs/specs/scanner-destination-memory.md`; Jira BOOKSHELF-58 (epic BOOKSHELF-62 Feedback), BOOKSHELF-27 (add books to a populated shelf)

## Context

BOOKSHELF-58 ("Need Scan to Same Library Option"): the scanner resets its destination every
time it opens. In `ScanModal.tsx` the owned/wishlist choice is made per book on the confirm
sheet, and **auto-add is hardcoded to Owned** (`autoAdd` → `commitAdd(isbn, "owned", …)`).
Someone cataloguing a stack of wishlist books re-picks "Wishlist" on every one.

Two existing facts shape the design:

- **`ScannerPreferencesContext`** already persists `postScanBehavior` and `scanMode` to
  `localStorage` via the `useLocalStorage` enum-with-validator pattern. A remembered
  destination is the same shape of thing.
- **"Destination" is just `ShelfStatus`** (`owned` | `want`; "Wishlist" per ADR-021). The
  scanner's add pipeline has no custom/target-shelf concept — auto-shelves are computed rules
  with no membership (ADR-019), and adding into a specific populated shelf is the separate,
  unstarted BOOKSHELF-27.

## Decision

### 1. Persist destination as a third scanner preference — client-only

Add `scanDestination: "owned" | "want"` (default `owned`) to `ScannerPreferencesContext`,
persisted at `scanner:destination` via the existing `useLocalStorage` + `memberOf([...])`
guard. Client-only, **per device** — reaffirming the `isbn-scanning.md` non-goal of
server-side scanner-preference persistence. A per-user, cross-device preference (like the
`PREF#SHELF` sort item in ADR-021) is deferred until a cross-device need is shown; a scanning
session is inherently one-device, one-sitting.

### 2. Surface it as a persistent top chip, not a footer toggle

The destination control is a pill anchored top-center **over the live viewfinder**
("Adding to Owned/Wishlist ▾", tap → two-option popover), visible throughout the scanning
view in barcode and text modes.

Rejected the alternative of an "Add to" segmented control in the footer alongside the
existing toggles (Option A). The footer is **covered by the confirm sheet and absent in the
camera-unavailable state**, and — decisively — in **auto-add** and **continuous** modes there
is *no* confirm sheet at all, so the footer would hide the destination in exactly the modes
where a wrong destination is committed silently and fastest. A chip over the viewfinder is
the one affordance guaranteed to be present when it matters. This directly serves the ticket's
"visible during scanning… never silently add to a surprising place."

### 3. Auto-add honours the remembered destination

`autoAdd` commits to `scanDestination` instead of the hardcoded `"owned"`. This is the single
behaviour change to a shipped feature: **continuous + auto-add cataloguing straight to
Wishlist becomes possible.** The always-visible chip is the guardrail that keeps that from
being a surprise.

### 4. The chip is the only setter; confirm buttons stay one-off overrides

The remembered default changes **only** when the user taps the chip. In confirm mode both
"Add owned" / "Add to wishlist" buttons remain; the chip's destination merely decides which is
primary/autofocused. Tapping the non-default button adds *that one book* to the other status
**without** mutating `scanDestination`.

Rejected "last add wins" (every add, including a one-off confirm-sheet tap, rewrites the
remembered destination). It's the more literal reading of "remember the last destination," but
it silently flips the default whenever a user makes a single off-default choice — a footgun in
the confirm flow. "Chip is the only setter" keeps the default predictable and the chip always
truthful about it.

### 5. Destination stays `{owned, want}`; target shelves deferred

Reuse `ShelfStatus` values. Custom/target-shelf destinations are out of scope and tied to
BOOKSHELF-27; when that lands the chip's model can widen to include a named target.

## Consequences

**Easier / cheaper:**

- Entirely client-side: no backend, CDK, DynamoDB, or migration. It's an additive scanner
  preference plus one presentational chip — the cheapest shape this feature can take, mirroring
  how `scanMode`/`postScanBehavior` already work.
- The default-Owned choice means first-ever open behaves exactly as today.

**New / behaviour change:**

- Auto-add's target moves from a hardcoded `"owned"` to the remembered destination. Anyone who
  relied on "auto-add always means Owned" now gets the chip's destination — mitigated by the
  chip being always visible and Owned remaining the default.
- Destination is deliberately **not** added to Account → Settings (it's remembered state, not
  configuration), so the settings surface stays limited to `postScanBehavior`/`scanMode`.

**To revisit:**

- If cross-device "same library" is requested, promote destination to a per-user preference
  (extend ADR-021's `PREF#SHELF` item / `/v1/preferences`) rather than keeping it device-local.
- BOOKSHELF-27 will extend the destination model beyond owned/wishlist.
- Optional `scan_destination_changed` analytics event (ADR-016: add to both the client
  `AnalyticsEvent` union and server `ALLOWED_EVENTS` allowlist) if change-rate insight is wanted.

## Open (implementation) items

1. `ScannerPreferencesContext`: add `scanDestination` + `setScanDestination` (key
   `scanner:destination`, `memberOf(["owned","want"])`, default `owned`).
2. `ScanModal`: render the destination chip over the viewfinder (top-center, barcode + text
   modes) with a two-option popover; wire it to the preference.
3. `ScanModal.autoAdd`: commit to `scanDestination` instead of `"owned"`.
4. `ConfirmSheet` / no-match `ManualPanel`: order/emphasise buttons by `scanDestination`; taps
   remain per-book overrides that don't mutate the stored default.
5. Tests: default Owned; chip switch persists across remount; auto-add uses remembered
   destination; confirm override doesn't change the default; legacy/invalid value → Owned.
