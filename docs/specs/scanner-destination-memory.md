# Spec: Scanner Remembers the Last Destination (BOOKSHELF-58)

**Status**: Implemented (PR pending merge)
**Date**: 2026-07-04
**Jira**: BOOKSHELF-58 (epic BOOKSHELF-62 Feedback) — labels `design-ui`, `p2`, `size-s`, `user-feedback`
**Related**: `docs/specs/isbn-scanning.md`, `docs/specs/isbn-text-scan.md`, ADR-021 (Wishlist terminology), ADR-026 (this decision), BOOKSHELF-27 (add books to a populated shelf — future "target shelf" destinations)

## Problem

User feedback (2026-07-01 synthesis, rank 11 of 14), verbatim:

> Need Scan to Same Library Option

Clarified with the user: reopening the scanner should **keep the previous session's
destination** instead of resetting every time. Today each scan session starts fresh —
in `apps/web/src/components/scanner/ScanModal.tsx` the owned/wishlist choice is made
per book on the confirm sheet ("Add owned" / "Add to wishlist"), and **auto-add is
hardcoded to Owned** (`autoAdd` → `commitAdd(isbn, "owned", …)`). A user cataloguing a
stack of wishlist books has to pick "Wishlist" on every single one, and nothing carries
their intent from one scan to the next.

## What "destination" means (scope)

In the scanner today a book's destination is exactly its **`ShelfStatus`**: `owned` or
`want` (rendered "Wishlist" per ADR-021 — the wire value stays `want`). There is **no
custom/target-shelf concept** in the add pipeline — smart shelves are computed rules with
no stored membership (ADR-019), and adding into a specific populated shelf is the separate,
unstarted BOOKSHELF-27. So **v1 destination = Owned vs. Wishlist**. Target-shelf
destinations are an explicit non-goal here and are deferred to BOOKSHELF-27.

## Goals

- Persist the last-used scan destination and preselect it when the scanner opens.
- Show the current destination **visibly during scanning** and let the user change it in
  one tap **without leaving the flow** — never silently add somewhere surprising.
- Work in both **single** and **continuous** modes, and in both **barcode** and **text**
  (OCR) input modes.
- Make **auto-add** honour the remembered destination (not always Owned).
- No backend, CDK, or DynamoDB changes — client-only, following the existing scanner
  preferences pattern.

## Non-goals

- Custom/named-shelf or "add into this shelf" destinations (owned/wishlist only) —
  deferred to BOOKSHELF-27.
- Cross-device sync of the remembered destination (client-only `localStorage`, per device,
  consistent with the other scanner preferences — see `isbn-scanning.md`).
- Surfacing destination in **Account → Settings**. Unlike `postScanBehavior` / `scanMode`
  (deliberate configuration that lives in Settings), destination is _remembered last-use
  state_; its only control is the in-scanner chip.
- Changing the default destination away from **Owned**.

## Design

### 1. New scanner preference — `scanDestination`

Add a third preference to `ScannerPreferencesContext`, persisted exactly like the existing
two via `useLocalStorage`:

| Preference            | Values                      | Default     | localStorage key           |
| --------------------- | --------------------------- | ----------- | -------------------------- |
| `postScanBehavior`    | `confirm` \| `autoAddOwned` | `confirm`   | `scanner:postScanBehavior` |
| `scanMode`            | `single` \| `continuous`    | `single`    | `scanner:scanMode`         |
| **`scanDestination`** | **`owned` \| `want`**       | **`owned`** | **`scanner:destination`**  |

- Values reuse `ShelfStatus` (`owned` \| `want`) so the destination feeds `commitAdd`
  directly with no mapping.
- Guarded by `memberOf(["owned", "want"])` — a missing, malformed, or legacy stored value
  falls back to `owned` (the `useLocalStorage` contract), so the UI can never wedge on a
  stale value.
- **Owned** is the default: it matches today's hardcoded auto-add target and the current
  primary confirm button, so nothing about the first-ever open changes.

### 2. Persistent destination chip (the visible control)

A pill button anchored **top-center over the viewfinder**, shown whenever the scanning view
is live (`view === "scanning"` with the camera starting/scanning), in both barcode and text
modes. It reads **"Adding to Owned"** / **"Adding to Wishlist"** with a leading icon and a
trailing chevron.

- **Tap → small popover** listing `Owned` and `Wishlist`, the current one checked; choosing
  one updates `scanDestination` and closes. (A two-value popover, not a silent toggle, so
  the change is explicit and screen-reader-legible.)
- Forced-dark styling with no `dark:` prefixes, matching `ScannerModeBar` and the flash pill
  (translucent `slate-950` fill, `white/10`–ish border, emerald accent on the active row).
- Accessibility: `<button>` with `aria-haspopup="menu"` / `aria-expanded`; the popover rows
  are a menu/listbox with the active option marked; the existing `aria-live="polite"` region
  announces the change ("Now adding to Wishlist"). Meets the 44px touch floor.
- This chip is why Option B (top chip) was chosen over a footer toggle: in **auto-add** and
  **continuous** modes there is no confirm sheet, and the footer is covered or absent — the
  one visible, always-present affordance is required exactly there. See ADR-026.

### 3. How each flow uses the destination

- **Auto-add** (`postScanBehavior === "autoAddOwned"`): `autoAdd` commits to
  `scanDestination` instead of the hardcoded `"owned"`. This is the one behaviour change to a
  shipped feature — continuous **+** auto-add cataloguing straight to **Wishlist** is now
  possible, and the chip is the (always-visible) guardrail against surprise.
- **Confirm mode** (`ConfirmSheet`): still shows **both** buttons. The chip's destination
  decides which is **primary** (`variant="app"` + `autoFocus`) and which is secondary — so
  the remembered destination is one tap / one Enter away. Tapping the non-primary button adds
  _that one book_ to the other status but **does not** change `scanDestination` (chip is the
  only setter — see ADR-026). Example: default Owned → "Add owned" primary, "Add to wishlist"
  secondary; tapping wishlist adds one wishlist book, chip stays Owned.
- **No-match manual entry** (`ManualPanel` "Add anyway"): same emphasis ordering by the
  remembered destination; the two explicit buttons remain.
- **Camera unavailable / manual entry**: the chip isn't shown (no live viewfinder), but the
  destination still applies through the panel's explicit buttons, so nothing is silent.

### 4. Analytics (optional, nice-to-have)

A `scan_destination_changed` event when the chip changes destination. Per ADR-016 this
requires adding the name to **both** the client `AnalyticsEvent` union
(`apps/web/src/lib/api-client.ts`) **and** the server `ALLOWED_EVENTS` allowlist. Optional —
not required to satisfy the acceptance criteria.

## Acceptance criteria

- [ ] Close and reopen the scanner → the previous destination is preselected: the chip shows
      it, auto-add commits to it, and the confirm sheet emphasises it.
- [ ] The destination chip is visible during scanning (barcode **and** text modes) and one
      tap changes it without leaving the flow.
- [ ] Works in both single and continuous modes.
- [ ] Auto-add commits to the remembered destination, not always Owned.
- [ ] In confirm mode, tapping the non-default button adds that single book without changing
      the remembered default (chip stays put).
- [ ] A missing/malformed/legacy `scanner:destination` value falls back to Owned; private-mode
      `localStorage` failure degrades to an in-memory Owned default without crashing.
- [ ] No backend, CDK resource, or DynamoDB schema changes.

## Test impact

`apps/web/src/components/scanner/ScanModal.test.tsx` and any `ScannerPreferencesContext`
tests gain coverage for: default Owned on first open; chip switches destination and it
persists across remount; auto-add commits to the remembered destination; confirm-mode
override does not mutate the stored default.

## Out of scope / follow-ups

- **BOOKSHELF-27** — adding books into a specific populated shelf; when that lands, the chip's
  destination model can extend from `{owned, want}` to include a named target shelf.
- Server-side, cross-device destination (mirrors the `PREF#SHELF` sort preference in ADR-021)
  only if a cross-device need is demonstrated.
