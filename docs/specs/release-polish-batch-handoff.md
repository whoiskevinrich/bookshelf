# Design Handoff: Release & Polish Batch (#2 cover fill, #5 mobile sizing)

**Status:** Ready for implementation
**Date:** 2026-06-13
**Source spec:** `docs/specs/release-polish-batch.md` (items #2 and #5)
**Stack:** React 19 + React Router 7 + Tailwind v4. Slate Blue theme. Dark mode is mandatory — every value below has a `dark:` pair.
**No Figma** — measurements are derived from the current code and expressed as Tailwind tokens. Pixel values that read as arbitrary (cover heights, breakpoint type) are marked _tune_ and may be nudged during build as long as the rules hold.

**Breakpoints (Tailwind defaults):** base `< 640px`, `sm ≥ 640px`, `md ≥ 768px`. The Pixel 7 Pro (~412px) is **below `sm`**, so "mobile" = unprefixed base utilities and "desktop" = `sm:`/`md:` overrides.

---

## ITEM #2 — Book cover framing (remove the letterbox band)

### Overview

Loaded covers currently sit in a forced `aspect-[2/3]` box with `object-contain` over a
`bg-slate-100 dark:bg-slate-700` fill, so any cover whose true ratio isn't 2:3 shows a slate
letterbox band — and the band reads as an ugly frame under the card's hover shadow/gradient.

**New model:** covers are normalized to a **consistent height**; the **image width is its natural
(intrinsic) aspect at that height**. No fill behind a _loaded_ image. A row/grid of covers aligns
on a shared baseline height, like a real shelf. The **fallback placeholder** (missing/broken image)
keeps a fixed 2:3 box with its slate background so empty slots stay uniform.

### The component contract change — `BookCover.tsx`

Today the caller passes `className="w-full aspect-[2/3]"` and `BookCover` applies the same classes
to both the `<img>` and the fallback `<div>`. That forced box is the root cause. Split the two:

| Element          | Old                                                                              | New                                                                                      |
| ---------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Loaded `<img>`   | `object-contain bg-slate-100 dark:bg-slate-700` + caller's `w-full aspect-[2/3]` | **`w-auto max-w-full object-contain`** at a caller-set **height**; **no `bg-*`**         |
| Fallback `<div>` | caller's `w-full aspect-[2/3]` + slate bg                                        | **keep `aspect-[2/3]` + `bg-slate-100 dark:bg-slate-700`** at the same caller-set height |

Recommended approach: stop passing width/aspect from callers; pass a **height** (e.g. `h-[195px]`
on the shelf, a responsive height on the landing grid) plus shared rounding. Inside `BookCover`:

- loaded image → `className="h-full w-auto max-w-full object-contain {rounded/shadow from caller}"`
  (height comes from the wrapper; `w-auto` lets intrinsic ratio set the width; `max-w-full` stops a
  freak landscape cover from overflowing its container).
- fallback → `className="h-full aspect-[2/3] bg-slate-100 dark:bg-slate-700 …"` so a missing cover
  still occupies a standard 2:3 slot.

`max-w-full` + `object-contain` on the image is belt-and-suspenders: in the normal case the box
equals the image so nothing is letterboxed; only a pathological wide cover would contain, and it
won't break the row.

### Shelf row — `ShelfBookCard.tsx`

|                                  | Old                                                                                                       | New                                                                                                                  |
| -------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Card wrapper (`:278`)            | `group/card flex flex-col gap-2 shrink-0 w-[130px] animate-fade-up`                                       | `group/card flex flex-col gap-2 shrink-0 w-max animate-fade-up`                                                      |
| Cover wrapper (`:282`)           | `relative rounded-lg overflow-hidden shadow-sm group-hover/card:shadow-xl transition-shadow duration-200` | **unchanged**                                                                                                        |
| `<BookCover className>` (`:288`) | `w-full aspect-[2/3]`                                                                                     | **`h-[195px]`** _(tune; = the current 130×2:3 height, preserves today's visual size)_                                |
| Info block (`:337`)              | `px-0.5`                                                                                                  | **unchanged** — with `w-max` on the card, the column width hugs the cover, and `line-clamp` wraps text to that width |

Result: each card is exactly as wide as its cover; a row of mixed-ratio covers shares a 195px top
and bottom edge with natural widths between. `gap-4` between cards is unchanged.

### Landing grid — `DemoShelf.tsx` (`BookGrid`, `:131`)

The grid **cell stays fixed width** (`grid-cols-2 sm:grid-cols-3 md:grid-cols-5`, `gap-4`
unchanged). The variable-width image is **centered inside** the cell.

| Element                          | Old                                                                                                                      | New                                                                                                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cell wrapper (`:133`)            | `group flex flex-col gap-2 rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-700/50 …`                               | **unchanged** (the cell hover highlight stays; with a centered natural-width image it now reads as a tidy padded highlight, not a letterbox frame)                                         |
| `<BookCover className>` (`:145`) | `w-full aspect-[2/3] rounded shadow-sm group-hover:scale-105 group-hover:shadow-md transition-all duration-200 ease-out` | **`h-44 sm:h-52 md:h-60 w-auto mx-auto rounded shadow-sm group-hover:scale-105 group-hover:shadow-md transition-all duration-200 ease-out`** _(heights tune to match current visual size)_ |

`mx-auto` centers the image in the fixed cell; `h-*` sets the shared row height per breakpoint;
`w-auto` (inside `BookCover`) gives natural width. The hover `scale-105` is preserved.

### Design tokens used (#2)

| Token                                              | Value           | Usage                                                      |
| -------------------------------------------------- | --------------- | ---------------------------------------------------------- |
| `bg-slate-100` / `dark:bg-slate-700`               | slate 100 / 700 | **Fallback placeholder only** — removed from loaded images |
| `rounded-lg` / `rounded`                           | 8px / 4px       | Cover wrapper / image corners (unchanged)                  |
| `shadow-sm` → `shadow-xl`                          | —               | Shelf card rest → hover (unchanged)                        |
| `aspect-[2/3]`                                     | 0.667           | **Fallback box only** now                                  |
| `h-[195px]` (shelf), `h-44 sm:h-52 md:h-60` (grid) | _tune_          | Normalized cover height                                    |

### States & interactions (#2)

| Element         | State                | Behavior                                                                                                                                                            |
| --------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cover (shelf)   | Hover / focus-within | Wrapper shadow `sm→xl` (200ms); dark gradient action overlay fades in. **Re-verify** the overlay still reads cleanly now that there's no slate band behind the art. |
| Cover (landing) | Group hover          | `scale-105` + `shadow-md` (200ms ease-out) + cell `bg-slate-100/700` highlight.                                                                                     |
| Cover           | Loaded               | Natural-width image at normalized height, no fill.                                                                                                                  |
| Cover           | Broken / missing     | Fallback 2:3 box at normalized height with slate bg + title/author text (unchanged behavior).                                                                       |

### Edge cases (#2)

- **Very wide (landscape) cover:** `max-w-full` caps width to the container; it contains by height rather than overflowing. Rare for books; acceptable.
- **Very narrow/tall cover:** renders narrow and centered (grid) / hugged by the card (shelf). No band.
- **Broken image mid-session:** `onError` flips to the fallback 2:3 box — slot stays the normalized height, so no row reflow jump.
- **Zero books:** unchanged — the empty-state message renders instead of the row/grid.
- **Mixed ratios in one row:** intended; shared height, ragged widths. This is the desired "real shelf" look.

### Accessibility (#2)

- `alt={title}` on loaded images, `aria-label` on the fallback (both already present) — keep.
- No color-only state introduced; the owned/wishlist status dot (emerald/sky) is decorative and already has a `title`/`aria-label`.
- Contrast unaffected (text moves off no backgrounds).

---

## ITEM #5 — Mobile sizing at ~412px (Pixel 7 Pro)

### Overview

At 412px the authenticated header overflows (`Sign out` wraps to a second line), the shelf's
horizontal book row clips its trailing card flush against the screen edge, uniform `px-6` gutters
pinch content, and the landing hero type is oversized. Fixes, all gated to **base → `sm`**:

1. **Header → hamburger menu** below `sm`; full inline nav returns at `sm+`.
2. **Book row → peek + trailing gutter** so it reads as scrollable.
3. **Gutters → `px-4 sm:px-6`** app-wide.
4. **Landing hero type steps down** at base.

### #5a — Header collapses to a menu — `AppHeader.tsx`

**Layout**

| Viewport       | Header contents                                                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `sm+` (≥640px) | Wordmark (left) · inline `<nav>` (right): My Library, Wishlist, About, [Account, Sign out if `user`], ThemeToggle — **current behavior, gated behind `sm:`** |
| base (<640px)  | Wordmark (left) · right cluster: **ThemeToggle + hamburger button**. All `NavLink`s and the Sign out button move into a tap-to-open menu panel.              |

Keep `ThemeToggle` visible at base (single icon, fits) so theme switching doesn't require opening
the menu. The hamburger is a real `<button>` (not a div).

**The menu panel** (base only): a full-width panel that drops **below** the header (header is in
normal flow, so use a normal-flow/absolute panel, not `position: fixed`). Contents stacked
vertically, each a ≥44px-tall row:

- My Library, Wishlist, About — `NavLink`s (active uses the existing `activeLinkClass`).
- Account (only if `user`).
- Sign out (only if `user`) — rendered as the last row, visually separated by a top hairline (`border-t border-slate-100 dark:border-slate-800`).

Panel surface: `bg-white dark:bg-slate-900`, `border-b border-slate-100 dark:border-slate-800`,
rows `px-4 py-3 text-sm`, active/hover `bg-slate-50 dark:bg-slate-800/60`.

**Design tokens (#5a)**

| Token                                    | Value                                     | Usage                                                   |
| ---------------------------------------- | ----------------------------------------- | ------------------------------------------------------- |
| `px-4 sm:px-6`                           | 16 / 24px                                 | Header gutter (was `px-6`)                              |
| `py-4`                                   | 16px                                      | Header vertical (unchanged)                             |
| `text-sm`                                | 14px                                      | Nav links + menu rows (unchanged)                       |
| `border-slate-100 dark:border-slate-800` | —                                         | Header + panel borders, Sign out divider                |
| `bg-slate-50 dark:bg-slate-800/60`       | —                                         | Menu row hover/active                                   |
| hamburger/X icon                         | 24px, `stroke-current`, `strokeWidth 1.5` | Match existing inline SVG icon style in `ShelfBookCard` |

**States & interactions (#5a)**

| Element          | State                | Behavior                                                                                                                 |
| ---------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Hamburger button | Default              | Shows hamburger (3 lines). `aria-label="Menu"`, `aria-expanded={open}`, `aria-controls="mobile-nav"`. ≥44×44px hit area. |
| Hamburger button | Open                 | Icon swaps to X. `aria-expanded="true"`.                                                                                 |
| Menu panel       | Open                 | Visible below header; first focusable item receives focus.                                                               |
| Menu panel       | Link tap             | Navigates **and** closes the panel; focus returns to the toggle.                                                         |
| Menu panel       | Click/tap outside    | Closes.                                                                                                                  |
| Menu panel       | `Escape`             | Closes; focus returns to the toggle.                                                                                     |
| Menu panel       | `Tab` past last item | Standard tab order; closes on blur out of header is optional (Escape + outside-click are required).                      |

**Responsive (#5a)**

| Breakpoint   | Header                                                                                    |
| ------------ | ----------------------------------------------------------------------------------------- |
| base (<640)  | Wordmark + ThemeToggle + hamburger; nav in panel.                                         |
| `sm+` (≥640) | Hamburger hidden (`sm:hidden`); inline nav shown (`hidden sm:flex`). Panel never renders. |

If a resize crosses `sm` while the panel is open, force it closed (the toggle is `sm:hidden`, so an
open panel would otherwise orphan). Guard in the resize/close logic.

**Animation (#5a)**

| Element    | Trigger | Animation                              | Duration | Easing   |
| ---------- | ------- | -------------------------------------- | -------- | -------- |
| Menu panel | Open    | `opacity 0→100` + `translateY(-4px)→0` | 160ms    | ease-out |
| Menu panel | Close   | reverse                                | 120ms    | ease-in  |
| Icon       | Toggle  | hamburger↔X (opacity/rotate ok)        | 150ms    | ease     |

`prefers-reduced-motion: reduce` → drop the translate/rotate; instant or opacity-only.

**Accessibility (#5a)**

- Toggle: `aria-label`, `aria-expanded`, `aria-controls="mobile-nav"`; panel has `id="mobile-nav"`.
- Focus moves into the panel on open, returns to the toggle on close (Escape, outside-click, link select).
- Operable by keyboard end-to-end; Escape closes.
- Touch targets ≥44px; no hover-only reveal (opens on tap/click).

> **Parallel note:** `PublicHeader` (landing/auth pages) is a separate component. If it shows the
> same overflow at 412px, apply the same base→`sm` treatment. Confirm during build; out of strict
> scope but flag if broken.

### #5b — Book row peek + trailing gutter — `ShelfPage.tsx` (`:209–214`)

**The bug:** the scroll container is `overflow-x-auto -mx-6 px-6` with an inner `flex gap-4 pb-3`.
A flex scroll container's **trailing padding collapses at scroll-end in most browsers**, so the last
card sits flush against the edge — reading as "cut off" rather than "scroll for more."

**Fix (do all three):**

1. **Gutter token:** `-mx-6 px-6` → **`-mx-4 px-4 sm:-mx-6 sm:px-6`** (matches the new page gutter).
2. **Persistent trailing gutter:** append a zero-content spacer as the last flex child so a gutter
   survives scroll-end: `<li aria-hidden="true" className="shrink-0 w-px" />` — or, simpler, add
   `after:content-[''] after:shrink-0 after:w-2` to the inner flex. Either guarantees trailing space.
3. **Peek (optional but recommended):** add scroll-snap for a polished feel — inner flex `snap-x`,
   each card `snap-start`. The peek itself is inherent once cards overflow; snap makes the rest feel
   intentional. P1 — ship the gutter fix even if snap is deferred.

**States (#5b)**

| Element  | State             | Behavior                                                                              |
| -------- | ----------------- | ------------------------------------------------------------------------------------- |
| Book row | Overflows width   | Horizontal scroll (intentional, unchanged). Thin styled scrollbar already set inline. |
| Book row | Scrolled to end   | Trailing gutter present; last card not flush.                                         |
| Book row | Fits within width | No scroll; left-aligned; no awkward gap.                                              |

### #5c — Page gutters & landing type

**Gutters (app-wide):**

| File                           | Old                            | New                                             |
| ------------------------------ | ------------------------------ | ----------------------------------------------- |
| `ShelfPage.tsx` main (`:384`)  | `max-w-6xl mx-auto px-6 py-10` | `max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-10`  |
| `AppHeader.tsx` (`:23`)        | `px-6 py-4`                    | `px-4 sm:px-6 py-4`                             |
| `LandingPage.tsx` main (`:10`) | `max-w-5xl mx-auto px-6 py-16` | `max-w-5xl mx-auto px-4 sm:px-6 py-10 sm:py-16` |
| Shelf scroll (`:211`)          | `-mx-6 px-6`                   | `-mx-4 px-4 sm:-mx-6 sm:px-6`                   |

**Landing hero type — `LandingPage.tsx`:**

| Element                | Old                  | New _(tune)_                                 |
| ---------------------- | -------------------- | -------------------------------------------- |
| `<h1>` (`:12`)         | `text-4xl font-bold` | `text-2xl sm:text-3xl md:text-4xl font-bold` |
| Sub `<p>` (`:15`)      | `text-lg`            | `text-base sm:text-lg`                       |
| Hero block (`:11`)     | `mb-12`              | `mb-8 sm:mb-12`                              |
| Demo container (`:26`) | `p-8`                | `p-4 sm:p-8`                                 |

**Design tokens (#5c)**

| Token                              | Value     | Usage                           |
| ---------------------------------- | --------- | ------------------------------- |
| `px-4` / `sm:px-6`                 | 16 / 24px | Page + header gutters           |
| `py-8 sm:py-10` / `py-10 sm:py-16` | —         | Shelf / landing vertical rhythm |
| `text-2xl … md:text-4xl`           | 24 → 36px | Landing hero scale              |
| `text-base sm:text-lg`             | 16 → 18px | Landing subhead                 |

### Edge cases (#5)

- **Logged-out state in `AppHeader`:** Account + Sign out are `user`-gated; the menu shows only the visible items. (`AppHeader` renders on authenticated pages, so `user` is normally present — keep the guard.)
- **Long shelf name** in the section header: already `shrink-0`/`truncate`-friendly; verify it truncates rather than pushing the count/actions off-screen at 412px.
- **Zero books:** empty-state paragraph renders in place of the row — confirm it fits within `px-4` with no overflow.
- **Resize across `sm` with menu open:** force-close (see #5a).
- **No page-level horizontal scroll** at 412px is the acceptance bar: the only intentional horizontal scroll is the per-shelf book row.
- **Touch & the existing card action overlay:** the move/remove overlay reveals on hover/`focus-within`. On touch there's no hover; `focus-within` triggers when a child button is focused (tap). This is pre-existing and out of #5 scope, but note it — if mobile users can't reach the actions, raise a follow-up.

### Animation (#5)

| Element              | Trigger     | Animation                 | Duration    | Easing             |
| -------------------- | ----------- | ------------------------- | ----------- | ------------------ |
| Mobile menu panel    | Open/close  | opacity + 4px translateY  | 160 / 120ms | ease-out / ease-in |
| Book row (opt.)      | Scroll      | scroll-snap to card start | native      | —                  |
| Existing cover hover | Hover/focus | unchanged                 | 200ms       | ease-out           |

### Accessibility summary (#5)

- Menu: labelled toggle, `aria-expanded`/`aria-controls`, focus management, Escape, keyboard-operable, ≥44px targets.
- No hover-only affordances introduced.
- Type scale-down preserves contrast (same slate tokens); minimum body text stays ≥16px on mobile.
- Reduced-motion respected for the menu.

---

## Implementation order

1. **#5c gutters + landing type** — pure utility swaps, lowest risk, immediately improves the 412px view.
2. **#5b book-row gutter** — small, contained; fixes the most "broken-looking" symptom.
3. **#2 cover framing** — touches `BookCover` contract + both consumers; do as one change and re-verify hover in light + dark.
4. **#5a header menu** — most logic (state, focus, a11y); its own slice with the menu-specific tests.

All four verify at **412×915** in light + dark with **no page-level horizontal scrollbar**, then run
the standard pre-merge gate (`pnpm version:bump` → `pnpm preflight` → `/pr-review-toolkit:review-pr all`
→ qa-checklist) per `docs/runbooks/pr-workflow.md`.
