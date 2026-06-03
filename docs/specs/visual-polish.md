# Spec: Visual Polish — UI Delight Pass

**Status:** Draft  
**Date:** 2026-06-02  
**Author:** Kevin Rich

---

## Problem Statement

The Bookshelf app is functional but visually flat. Covers are static, interactive feedback is minimal, and the shelf view presents books as a plain grid with no sense of depth or personality. Users who care about their book collections expect a UI that feels curated — not a spreadsheet. Without tactile delight, the app feels like a utility rather than something worth returning to.

---

## Goals

1. Increase perceived quality: the app should feel premium on first interaction without looking cluttered.
2. Make covers the visual hero — they are the most meaningful content on the page.
3. Add motion that is purposeful and subtle, never distracting.
4. Maintain full accessibility: no delight feature should block keyboard/screen-reader users.
5. All polish ships in one pass with zero new dependencies.

---

## Non-Goals

- **No full redesign** — layout, color palette (Slate Blue theme), and component structure stay.
- **No new pages or routes** — this is purely presentational.
- **No skeleton redesign** — `ShelfSkeleton` stays as-is; polish doesn't block loading states.
- **No animation library** — Tailwind's built-in `transition` + `transform` utilities are sufficient.
- **No carousel on mobile** — the carousel is desktop-only (≥ md breakpoint); mobile keeps the grid.

---

## Proposed Features (Evaluated)

### ✅ P0 — Cover Scale on Hover

**Description:** Book covers in the shelf grid scale up slightly (`scale-105`) and gain a soft drop shadow on hover/focus, with a 200 ms ease-out transition.

**Why it works:** Immediate tactile feedback. Signals interactivity. Standard pattern for content grids (Spotify, Letterboxd). Zero risk of feeling garish at `scale-105`.

**Acceptance criteria:**

- [ ] `transition-transform duration-200 ease-out hover:scale-105` applied to cover wrapper in the shelf grid.
- [ ] Shadow deepens on hover: `shadow-sm` → `shadow-md`.
- [ ] Focus-visible also triggers the scale (keyboard accessible).
- [ ] Works in both light and dark modes.
- [ ] No layout shift (cover wrapper uses `overflow-hidden`).

---

### ✅ P0 — Book Card Fade-In on Load (Staggered)

**Description:** When the shelf loads, book cards animate in with a staggered fade-up (`opacity-0 → opacity-100` + `translateY(8px) → 0`) — each card delayed by ~50 ms × index.

**Why it works:** Replaces the jarring "everything appears at once" pop with a gentle cascade. Used on every quality content app (Airbnb, Apple Music). The stagger covers only the first 8–10 cards; beyond that all cards share the last delay value.

**Acceptance criteria:**

- [ ] `@keyframes fadeUp` defined in `index.css` (or via Tailwind `animate-*`).
- [ ] Each card applies `animation-delay: calc(index * 50ms)` inline.
- [ ] Animation plays only on initial shelf mount, not on subsequent re-renders.
- [ ] `prefers-reduced-motion`: animation is skipped entirely (cards appear immediately).
- [ ] No flicker on dark mode.

---

### ✅ P0 — Empty Shelf Illustrated State

**Description:** When a user's shelf is empty, replace the bare text fallback with a centered illustration placeholder (open book SVG or stylized stack), a friendly heading ("Your shelf is empty"), a short subline ("Add your first book to get started"), and a primary CTA button.

**Why it works:** Empty states are the highest-leverage UX moment — it's when new users decide if the app is worth continuing. A polished empty state signals craft and reduces abandonment. It also satisfies the code-review checklist requirement for zero-books handling.

**Acceptance criteria:**

- [ ] Inline SVG (no external assets) of an open book or stacked books in slate color palette.
- [ ] Heading: `"Your shelf is empty"` (h2, text-xl).
- [ ] Subline: `"Search for a book above to add your first one."` (text-sm, muted).
- [ ] CTA button uses `<Button>` primitive (variant: `app`).
- [ ] Displays correctly in both light and dark modes.
- [ ] Zero layout shift — empty state is the same container as the grid.

---

### ✅ P1 — Shimmer Skeleton (Replace Pulse)

**Description:** Replace the current `animate-pulse` opacity blink on `ShelfSkeleton` with a shimmer sweep (`background: linear-gradient(90deg, ...)` sliding from left to right).

**Why it works:** Shimmer is a more polished loading convention (used by Facebook, LinkedIn, GitHub). It communicates directionality and feels faster than a static pulse blink. Purely CSS — no JS.

**Acceptance criteria:**

- [ ] `@keyframes shimmer` defined in `index.css`.
- [ ] `ShelfSkeleton` cards use shimmer instead of `animate-pulse`.
- [ ] Dark mode shimmer uses dark slate tones (no harsh contrast).
- [ ] `prefers-reduced-motion`: falls back to no animation (flat color).

---

### ✅ P1 — Section Header Divider Styling

**Description:** The "Owned" and "Wishlist" section headers on the shelf page get a visual upgrade: a thin decorative line extending to the right of the label, and the count badge rendered as a small pill.

**Why it works:** Currently headers are plain text with no visual separation. The divider adds breathing room and hierarchy without adding clutter. The count pill makes quantities scannable at a glance.

**Acceptance criteria:**

- [ ] Header row: `flex items-center gap-3` — label + horizontal rule (flex-grow) + count pill.
- [ ] Count pill: `text-xs bg-slate-100 dark:bg-slate-800 rounded-full px-2 py-0.5`.
- [ ] No change to font weight or text size (preserve existing `text-sm font-semibold uppercase tracking-wide`).
- [ ] Renders correctly at all viewport widths.

---

### 🔲 P2 (Future) — Carousel for Shelf Grid

**Description:** On desktop (≥ md), replace the static book grid with a horizontally scrollable carousel showing covers at a larger size, with prev/next arrow controls and scroll-snap.

**Why considered:** Carousels surface covers prominently and feel premium. Letterboxd, Goodreads, and Apple Books all use them.

**Why deferred:** Carousels require careful keyboard and screen-reader implementation (roving tabindex, aria-roledescription). They also conflict with the current two-section layout (Owned / Wishlist have separate grids). The simpler polish items above deliver most of the perceived quality gain at a fraction of the risk. Revisit after the shelf UX is more settled.

---

## User Stories

- As a book lover, I want covers to respond visually when I hover over them, so I can feel the interface is alive and interactive.
- As a new user, I want to see a welcoming empty state when my shelf has no books, so I understand what to do next.
- As any user, I want the page to load in a way that feels smooth and intentional, not an abrupt pop-in.
- As a keyboard user, I want hover effects to also appear on focus, so I have the same tactile experience.

---

## Success Metrics

**Leading (measurable within 2 weeks of deploy):**

- Zero new accessibility issues reported (WCAG AA).
- No regression in Lighthouse performance score (remain ≥ 90).

**Lagging:**

- Qualitative: the app "feels like a real product" in user feedback.
- Return session rate (anecdotal, solo product).

---

## Open Questions

| Question                                                                          | Owner       | Blocking?                                    |
| --------------------------------------------------------------------------------- | ----------- | -------------------------------------------- |
| Should the empty state use an SVG illustration or a Lucide icon composition?      | Design      | No — default to Lucide `BookOpen` icon stack |
| Should stagger animation cap at 8 cards or 12?                                    | Engineering | No — cap at 10                               |
| Should the shimmer skeleton be a global CSS utility or scoped to `ShelfSkeleton`? | Engineering | No — scoped                                  |

---

## Timeline

No hard deadline. All P0 items are self-contained and can ship in a single PR. P1 items can be bundled into the same PR if time allows, or deferred to a fast-follow. P2 (carousel) is its own future spec.

**Recommended ship order:** P0 items first (cover hover, fade-in, empty state), then P1 in the same PR if the diff stays manageable.
