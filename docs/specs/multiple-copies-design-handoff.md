# Handoff Spec: Multiple Copies of the Same Book (BOOKSHELF-60)

**Status**: Ready for implementation
**Date**: 2026-07-10
**Jira**: [BOOKSHELF-60](https://whoiskevinrich.atlassian.net/browse/BOOKSHELF-60) (epic BOOKSHELF-62 Feedback)
**Related**: `docs/specs/multiple-copies.md` (product decision), `docs/specs/multiple-copies-system-design.md` (API/data-model deep dive) — this doc covers the third leg: **frontend component-level spec** for the two new UI surfaces (card badge, detail stepper) and the extended duplicate-add flow.

No Figma file exists for this feature — there's no design tool connected to this workspace. This spec is grounded directly in the running app: existing components (`ShelfBookCard`, `BookDetailPage`, `Button`, `ConfirmDialog`) and `docs/design-system.md` tokens, extended to cover the new `copies` attribute per the product spec's UX section.

## Overview

Owned books can now have a `copies` count (1–99, default 1). Two new UI surfaces make it visible and editable:

1. A small badge on the shelf book card, shown only when `copies > 1`.
2. A stepper on the book detail page's "Your copy" panel, shown only when the book is owned.

A third change extends the existing 409-duplicate-add handling (search-add and scanner) to offer "add another copy" instead of a dead-end message.

## Layout

No new page or route. Both surfaces slot into existing layouts:

- **Card badge** — `ShelfBookCard.tsx` (`apps/web/src/components/shelf/ShelfBookCard.tsx:436-467`), inside the always-visible pill layer (`pointer-events-none absolute inset-0`) that already renders the Owned/Wishlist pill (`top-1.5 left-1.5`) and reading-status pill (`bottom-1.5 left-1.5`). The copies badge takes the one open corner: `absolute top-1.5 right-1.5`.
- **Detail stepper** — `BookDetailPage.tsx`'s `YourCopyPanel` (`apps/web/src/pages/BookDetailPage.tsx:45-224`), as a new `<div className="space-y-2">` row following the exact pattern of the existing Status/Reading-status/Tags rows, placed directly after the Status `SegmentedControl` (before Reading status) since copies is a property of ownership.
- **Duplicate-add prompt** — no new page; extends the existing 409 handling in `ShelfPage.tsx:716-722` (search-add) and `ScanModal.tsx`'s `commitAdd`/`ManualPanel`/flash-pill paths (scan-add).

## Design Tokens Used

| Token                          | Value     | Usage                                                                                                |
| ------------------------------ | --------- | ---------------------------------------------------------------------------------------------------- |
| `paper-100`                    | `#F4F0E6` | Card grid background (existing)                                                                      |
| `paper-200` / `dark:slate-800` | `#EAE4D4` | Stepper track background                                                                             |
| `paper-400` / `dark:slate-700` | `#DDD5C1` | Stepper track border, section dividers                                                               |
| `slate-900` / `dark:white`     | —         | Stepper count text, primary text                                                                     |
| `slate-600` / `dark:slate-400` | —         | Helper copy under the stepper                                                                        |
| `text-xs` (12px)               | —         | Documented class for "count badges" (`docs/design-system.md:74`) — applies to the copies badge digit |
| `rounded-full`                 | —         | "Count badges, pills" radius (`docs/design-system.md:115`) — the copies badge                        |
| `rounded-lg`                   | 8px       | Stepper track container (matches `SegmentedControl`'s track radius)                                  |

No new tokens are introduced. The `c-coral-*` accent is **not** used here — it's reserved for "new/notification" semantics (What's New), and a copies count isn't a notification (`docs/design-system.md:58-62`).

## Components

| Component                            | Variant                        | Props                                                                                                                            | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------ | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Copies badge** (new)               | Cover-overlay pill             | none (presentational, takes `copies: number`)                                                                                    | Mirrors `StatePill` (`ShelfBookCard.tsx:181-188`): `inline-flex items-center gap-1 rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white`. Icon + digit (e.g. a stacked-layers icon + "×3") — never a bare colored dot, satisfying the color-only rule via the digit itself. Renders **nothing** when `copies <= 1` (zero visual change for the common case, per product spec). Lives in the `pointer-events-none` pill layer, not the hover-action overlay — always visible, matching the existing pills.                                                                                                  |
| **Copies stepper** (new)             | Detail-page row                | `value: number`, `min=1`, `max=99`, `onChange(next: number)`, `disabled?: boolean`                                               | Net new — no stepper precedent exists in the codebase (confirmed: no `stepper`/`increment`/`quantity` UI anywhere). Track styled like `SegmentedControl`'s container (`inline-flex rounded-lg border border-paper-400 dark:border-slate-700 bg-paper-200 dark:bg-slate-800 p-0.5`) holding two icon buttons (`ti-minus`/`ti-plus`, **44×44px** — the WCAG 2.5.8 touch-target floor, see Accessibility) and a `min-w-[28px] text-center text-sm font-medium` count. Sends the **absolute new value** on each tap (`PATCH /v1/shelf/:isbn { copies: n }`), per the system-design doc's "absolute value, not atomic ADD" decision. |
| `<Button>` (existing)                | `secondary`/`app`, `size="sm"` | —                                                                                                                                | Used in the duplicate-add `ConfirmDialog`'s Cancel/Confirm row; no new variant needed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `<ConfirmDialog>` (existing, reused) | non-destructive                | `open`, `title="Add another copy?"`, `message`, `confirmLabel="Add another copy"`, `destructive={false}`, `onConfirm`, `onClose` | Reused as-is for the **search-add** flow (`ShelfPage.tsx`) duplicate 409 — it's a decision the user must confirm, not an ambient tip, so `Callout` (which is explicitly "never modal or blocking") is the wrong fit; `ConfirmDialog` already exists for exactly this "confirm before doing a thing" shape (see `RemovePanel`'s reuse for a parallel precedent).                                                                                                                                                                                                                                                                 |

### Scanner duplicate-add — deliberately NOT the global `ConfirmDialog`

`ScanModal` runs on a forced-dark surface regardless of app theme (`.claude/rules/scanner.md`: "scanner internals have no `dark:` prefixes — the surface is unconditionally dark"). The global `ConfirmDialog` follows the app's light/dark theme (`bg-paper-50 dark:bg-slate-800`), so popping it over the always-dark camera view would show a light-themed dialog over a dark background when the user is in light mode — inconsistent with every other scanner surface (`ConfirmSheet`, `AddedSheet`: `bg-slate-900`, no `dark:` prefixes). Instead, extend the scanner's own bottom-sheet pattern:

- **`postScanBehavior === "confirm"`, source `"sheet"`** (single/manual lookup): today `commitAdd` does `setError("That book is already on your shelf.")`, rendered inline in `ConfirmSheet` (`text-xs text-red-400`, line 684). Extend this branch to also render an inline "Add another copy" button matching `ManualPanel`'s existing `onAddAnyway` two-button row pattern (lines 845-865) — same dark, no-`dark:`-prefix styling, same `Button` sizes.
- **`postScanBehavior === "autoAddOwned"`, source `"auto"`** (continuous scan): today shows the amber duplicate flash (`border-amber-400/40 bg-amber-500/15 text-amber-300`, line 434). **Open question (Q1, carried from `docs/specs/multiple-copies.md`)**: does this auto-increment silently, or does continuous mode simply never offer "add another copy" (since there's no sheet to prompt in)? The spec leans "always prompt, never silent" but flags this as unresolved for frontend-design. Recommendation for this handoff: **continuous/auto mode keeps today's amber "already on your shelf" flash unchanged** — auto-add is opt-in ergonomics for _new_ books, and silently incrementing a copies count on every rescan of an already-owned barcode would violate "never silent." Copies incrementing stays a `"sheet"`-source-only action until/unless product decides otherwise.

## States and Interactions

| Element                                    | State                     | Behavior                                                                                                                                                                                                                                |
| ------------------------------------------ | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Copies badge                               | `copies <= 1`             | Not rendered — no DOM node, no layout reservation                                                                                                                                                                                       |
| Copies badge                               | `copies > 1`              | `×N` pill, top-right of cover, same visual weight as the other two pills                                                                                                                                                                |
| Stepper `−` button                         | `value === 1`             | `disabled` (native `disabled` attribute + `opacity-40` per `<Button>`'s existing disabled pattern) — 1 is the floor, not deletable via stepper (product spec: "count to 0 is not a delete shortcut")                                    |
| Stepper `+` button                         | `value === 99`            | `disabled` — `COPIES_MAX` ceiling                                                                                                                                                                                                       |
| Stepper                                    | book is `want` (wishlist) | Entire "Copies" row hidden (matches `copies` being owned-only; no disabled/greyed state to avoid an orphaned control with no explanation)                                                                                               |
| Stepper                                    | owned → want transition   | Server resets `copies` to 1 (per system-design doc §4); the row disappears immediately since `entry.owned` flips                                                                                                                        |
| Stepper tap                                | in flight                 | Buttons disabled during the `PATCH` mutation (matches `YourCopyPanel`'s existing mutation-pending pattern for tags/notes); no separate loading spinner — round-trip is fast enough that the existing disabled-state convention suffices |
| Stepper tap                                | mutation error            | Inline `text-xs text-red-500 dark:text-red-400` message below the stepper, matching `tagsMutation.isError` rendering at `BookDetailPage.tsx:183-187`                                                                                    |
| Duplicate-add `ConfirmDialog` (search-add) | shown                     | Fires when `addMutation` 409s (`isConflictError(addMutation.error)`), replacing today's static `"That book is already on your shelf."` text with the dialog                                                                             |
| Duplicate-add confirm                      | tapped                    | `PATCH /v1/shelf/:isbn { copies: currentCopies + 1 }`; on success, close dialog and show the same "added" feedback used elsewhere (no new success surface)                                                                              |
| Duplicate-add cancel                       | tapped                    | Dialog closes, no mutation — book stays at its current copy count                                                                                                                                                                       |

## Responsive Behavior

| Breakpoint               | Changes                                                                                                                                                                                                                                                                                                                                |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Desktop (>1024px)        | Card grid as today; stepper inline in the "Your copy" panel at its existing max-width (`max-w-4xl` page container)                                                                                                                                                                                                                     |
| Tablet / Mobile (<768px) | No changes — the card is already a fixed `w-[136px]` column regardless of viewport (existing horizontal-scroll shelf pattern); the stepper's 44×44px buttons clear the touch-target floor at every breakpoint, so no responsive floor/relax pattern (like `<Button>` `md`'s `py-3 sm:py-2`) is needed here — it's 44px unconditionally |

## Edge Cases

- **`copies` absent (legacy entries)**: reads as `1` server-side (dual-read default) — badge doesn't render, stepper shows `1`. No client-side fallback needed.
- **`copies` at max (99)**: badge shows `×99` unclipped (2-digit fits the existing pill sizing used by reading-status labels); stepper `+` disabled.
- **Rapid double-tap on stepper**: buttons disable for the mutation's duration, so a second tap during an in-flight `PATCH` is a no-op, not a queued increment — prevents the absolute-value race the system-design doc's §5 flags as an accepted limitation.
- **Duplicate-add on a `want` (wishlist) entry**: doesn't apply — the 409 path is for owned-duplicate detection; scanning/searching an ISBN already on the wishlist is a different existing flow (moves it, doesn't offer a copy).
- **Slow connection**: stepper `+`/`−` stay disabled until the in-flight `PATCH` resolves (no optimistic increment) — consistent with every other attribute patch on this page today (none of tags/notes/reading-status are optimistic either).

## Animation / Motion

| Element                       | Trigger                                            | Animation                                                                                                | Duration | Easing |
| ----------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------- | ------ |
| Copies badge                  | mount/unmount (crossing the `copies > 1` boundary) | None — appears/disappears immediately, no transition                                                     | —        | —      |
| Stepper count                 | value change                                       | None — text swaps immediately (matches `SegmentedControl`'s immediate state swap, no counting animation) | —        | —      |
| Duplicate-add `ConfirmDialog` | open                                               | Inherits `ConfirmDialog`'s existing portal fade-in (no feature-specific animation)                       | —        | —      |

## Accessibility Notes

- **Stepper buttons are 44×44px** — `docs/design-system.md`'s touch-target rule (WCAG 2.5.8, "no `py-1` or smaller") applies here; a shrunk custom size (e.g. matching `SegmentedControl`'s denser track buttons) would fall below the floor. Use a dedicated 44×44px icon-button treatment (same `aria-label` + `hover:bg` pattern as `OverlayButton`/`Callout`'s dismiss button), not `<Button>` `sm` (`px-2.5 py-1.5` measures to roughly 30px tall, also under the floor) — build the stepper's `−`/`+` buttons as fixed `h-11 w-11` (44px) regardless of the track's overall compactness.
- Stepper is a native two-button + text control, not a `role="spinbutton"` widget — simpler and sufficient given the bounded, discrete 1–99 range (no need for arrow-key handling beyond native tab order between the two buttons).
- `aria-label="Remove a copy"` / `aria-label="Add a copy"` on the stepper buttons (icon-only, per the existing `OverlayButton`/`ShelfPicker` pattern of `title` + `aria-label` on icon buttons).
- Copies badge icon is `aria-hidden="true"`; the "×N" text is the accessible content (already text, no separate `aria-label` needed — matches how the existing Owned/Wishlist/reading-status pills expose their label as visible text, not an icon-only aria-label).
- Copies row disappearing on owned→want isn't announced via `aria-live` — it's a direct result of a `SegmentedControl` toggle the user just activated, so the change is expected/attributable, unlike an out-of-band update.
