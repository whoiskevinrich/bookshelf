# Handoff Spec: Phase 3 — Auto/Smart-Shelf Surfaces

**Status:** Ready for build
**Date:** 2026-06-28
**Source design:** `/design-critique` + `/design-handoff` mockups (shelf-card state pills, book-detail view, auto-shelf surfacing, smart-shelf three-tier)
**Parent spec:** [book-attributes-tags-auto-shelves.md](book-attributes-tags-auto-shelves.md) Phase 3 (R3.1–R3.4)
**Architecture:** [ADR-019](../adrs/019-book-attributes-tags-auto-shelves.md) §2 (three-tier model)
**Design system:** [design-system.md](../design-system.md) — slate-only palette; `<Button>`, `<Callout>`, `<SegmentedControl>` primitives; shape+text (never color-only) state rule; 44×44 tap targets.

> Stack: React + Tailwind v4 (class dark mode), TanStack Query, `react-router-dom`. Tailwind default breakpoints (`sm` = 640px, `md` = 768px, `lg` = 1024px). This app uses **`sm:`** as its primary mobile→desktop switch.

---

## Overview

Phase 3 turns the Phase 1 attributes + Phase 2 tags into browsable views, without turning a large library into a wall of rows. Five surfaces, in dependency order:

1. **`ShelfBookCard` state encoding** — replace the color-only status dot with icon+label pills (prerequisite; fixes a current a11y bug).
2. **System-facet filter bar** — Owned / Want / Reading / Finished / Unread, always-on filters.
3. **Ad-hoc tag/author browse** — on-demand type-ahead; nothing pre-listed.
4. **Save-as-smart-shelf flow** — pin an active filter combination as a standing smart shelf.
5. **Smart shelves alongside curated shelves** — rule badge vs drag handle.

All five live on **`ShelfPage`** (`apps/web/src/pages/ShelfPage.tsx`) and reuse its existing row layout, mutations, and `MobileMenu` pattern. `SingleShelfPage` is out of scope.

---

## Design Tokens Used

| Token                            | Value                          | Usage                                                                                    |
| -------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------- |
| `slate-900` / `dark:white`       | primary                        | Selected facet text/bg, primary actions (via `<Button variant="app">`)                   |
| `slate-500` / `dark:slate-400`   | muted floor                    | Unselected facet text, counts, hints (WCAG AA floor — never `slate-400` on light)        |
| `slate-200` / `dark:slate-700`   | hairline                       | Pill borders, dividers, filter-bar rule                                                  |
| `slate-100` / `dark:slate-800`   | subtle bg                      | SegmentedControl track, count-badge bg                                                   |
| `slate-50` / `dark:slate-800/50` | callout bg                     | `<Callout>` (save-flow confirmation, suggestions)                                        |
| `bg-emerald-* ` (state)          | —                              | **Do not reuse the bare dot.** Owned pill uses icon+label, not hue alone (see Surface 1) |
| `rounded-full`                   | pill                           | Facet chips, tag chips, count badges                                                     |
| `rounded-lg` (8px)               | —                              | Buttons (enforced), browse-panel container                                               |
| `rounded-2xl` (16px)             | —                              | Callouts, large containers                                                               |
| `text-xs` (12px)                 | —                              | Facet labels, pill text, counts                                                          |
| `gap-4` (16px)                   | —                              | Card grid gap (unchanged)                                                                |
| Card column                      | `w-[136px]`, cover `h-[195px]` | `ShelfBookCard` (unchanged)                                                              |

Icons: hand-drawn inline `<svg>` in the `ShelfBookCard`/`ShelfPage` convention (`viewBox="0 0 16 16"`, `w-3.5 h-3.5`, `stroke="currentColor"`, `strokeWidth="1.5"`, `aria-hidden`). **No icon webfont** — match the existing `MoveIcon`/`LayersIcon`/`TrashIcon` set.

---

## Surface 1 — `ShelfBookCard` state encoding

Replaces the color-only status dot ([ShelfBookCard.tsx:310](../../apps/web/src/components/shelf/ShelfBookCard.tsx:310)).

### Layout

- **Status pill**, absolute `top-1.5 left-1.5`, over the cover. `inline-flex items-center gap-1` · `text-[10px]` · `px-1.5 py-0.5` · `rounded-full` · `bg-black/55 text-white` (always-dark chip over cover art, like the action overlay) + a state icon.
  - Owned → check-circle icon (green) + "Owned".
  - Want → bookmark icon (red) + "Want".
  - Owned/Want are **mutually exclusive** (ADR-019 Q1 revised) → exactly one pill ever renders. Icon color reinforces the label; the text keeps it WCAG-safe.
- **Reading badge** (only when `readingStatus !== null`), absolute `bottom-1.5 left-1.5`: open-book icon + label ("Reading" / "Read" / "Unread"). Same chip style. Omit entirely when `null` to avoid clutter.
- **Tag chip + overflow** below the title block (after the ISBN line): first tag as a `rounded-full border border-slate-200 dark:border-slate-700 text-[10px] px-1.5` chip + `+N` muted count when `tags.length > 1`. Omit the row when `tags.length === 0`.

### States

| Element       | State                      | Behavior                                                                   |
| ------------- | -------------------------- | -------------------------------------------------------------------------- |
| Status pill   | Always visible             | State ≠ action — never behind hover/tap reveal (unlike the action overlay) |
| Reading badge | `readingStatus === null`   | Not rendered                                                               |
| Tag row       | `tags.length === 0`        | Not rendered                                                               |
| Card actions  | hover / focus-within / tap | Unchanged from today (keep the coarse-pointer tap-to-reveal)               |

### Accessibility

- Each pill is **icon + text** (passes WCAG 1.4.1 — fixes the current color-only failure). Icons `aria-hidden`; the text label carries meaning.
- The pill is decorative-redundant to nothing — it is the only state signal, so the text must be real text, not `title`/`aria-label` on an empty span.
- Don't add a tab stop for pills (they're not interactive); keep tab order = action buttons only.

### Edge cases

- **Long reading label**: labels are fixed enum strings — no truncation needed.
- **Quick action is one-directional**: the card's hover/tap move button only appears on **want** books ("Mark as Owned", green check). Owned→want is the confusing direction (QA feedback) — it lives in the book-detail view, not the card.
- **No cover**: pills render over the `BookCover` fallback (slate box) — `bg-black/55` keeps contrast.

---

## Surface 2 — System-facet filter bar

R3.1. Sits **below** the "My Library" title row, on its own line.

### Layout

- Row of facet chips: `All` · `Owned` · `Want` · `Reading` · `Finished` · `Unread`.
- Each chip: `inline-flex items-center gap-1.5` · `text-xs` · `px-3 py-1.5` · `rounded-full` · `border`.
  - **Selected**: `bg-slate-900 text-white dark:bg-white dark:text-slate-900 border-transparent`.
  - **Unselected**: `text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-slate-300`.
- Each facet (except `All`) carries its state icon (reuse Surface 1 icons) so selection isn't color-only.
- `All` is the default/cleared state.
- Selection model: **single-select** for v1 (one system facet at a time) — except it composes with an active tag/author from Surface 3 (the combined filter feeds Surface 4's save). Multi-select across system facets is out of scope (P2).

### Behavior

- Selecting a facet sets the `GET /v1/shelf` filter (`?owned=true` / `?want=true` / `?readingStatus=…`) and re-renders the existing row layout filtered to matches. `All` clears it.
- When a facet is active, the row layout shows a **single flat result grid** ("Owned · 42") rather than per-shelf rows — filtering is a _view_, not a reshuffle of curated shelves. Curated/smart shelves are hidden while a system facet is active; a "Clear filter" ghost button returns to the shelf view.

### States

| Element     | State                   | Behavior                                                      |
| ----------- | ----------------------- | ------------------------------------------------------------- |
| Facet chip  | Selected                | Filled (slate-900/white) + icon                               |
| Facet chip  | Hover (unselected)      | `border-slate-300 dark:border-slate-600`                      |
| Facet chip  | Focus                   | `focus:ring-2 focus:ring-slate-900 dark:focus:ring-slate-300` |
| Result grid | Empty (facet matches 0) | "No books are [Reading] yet." muted `text-sm text-slate-500`  |

### Responsive

| Breakpoint      | Changes                                                                                                                                                                                                        |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ≥ `sm` (≥640px) | Full chip row, wraps if needed                                                                                                                                                                                 |
| < `sm`          | Horizontally scrollable chip row (`overflow-x-auto`, hide scrollbar like the shelf rows); title-row actions ("+ New shelf", "Scan", "Add a book") fold into `MobileMenu` to fix the known header-crowding task |

### Accessibility

- Container `role="group" aria-label="Filter by status"`. Chips are `<button aria-pressed={selected}>`.
- Result grid wrapped in `role="status" aria-live="polite"` so the count change ("42 owned") is announced.
- Keyboard: chips are in tab order, left-to-right; Enter/Space toggles.

---

## Surface 3 — Ad-hoc tag/author browse (on-demand)

R3.2. **Nothing is pre-listed.** Opened from a "Browse" affordance (ghost button in the title row or a `ti`-style filter icon next to the facet bar).

### Layout

- A panel (reuse the `ShelfPage` inline-panel pattern: `mb-8 p-4 border border-slate-100 dark:border-slate-700 rounded-xl`) containing:
  - A text input (`inputClass` from `form-styles.ts`), placeholder "Filter by tag or author…".
  - Below it, a **type-ahead result list**: matching tags (tag icon) and authors (user icon), each with a count, sorted by frequency desc, then alpha. Cap initial render to the **top ~12**; the rest appears only as the query narrows.
  - Each result row: `flex items-center gap-2 px-3 py-1.5 text-sm rounded-md hover:bg-slate-50 dark:hover:bg-slate-700/60`, count right-aligned muted.

### Data

- Tags: `GET /v1/tags` (R2.4) → distinct normalized tags. Counts computed client-side from the loaded shelf, or returned by the endpoint.
- Authors: distinct authors from the `BOOK#<isbn>` cache of loaded entries (client-derivable for v1; a dedicated endpoint is P1).

### Behavior

- Selecting a result applies it as an **active filter chip** (Surface 4's filter state) and closes the panel. Applying a tag filter renders the matching flat grid (same as a system facet).
- Type-ahead is **client-side filter** over the distinct set (no per-keystroke API calls).

### States / edge cases

| Case                   | Behavior                                                                            |
| ---------------------- | ----------------------------------------------------------------------------------- |
| Empty query            | Show top ~12 by frequency + "type to find" hint when more exist                     |
| No matches             | "No tags or authors match '[q]'." muted                                             |
| Zero tags in library   | Panel shows only authors; if both empty, "Add tags to your books to browse by tag." |
| Very large vocabulary  | Only matches render; never list the full long tail (the core anti-noise rule)       |
| Long tag/author string | Truncate row label `truncate`; count never truncates                                |

### Accessibility

- Input + list form a combobox: input `role="combobox" aria-expanded aria-controls`, list `role="listbox"`, rows `role="option"`. Arrow keys move; Enter selects; Esc closes (reuse the `ShelfPicker` keyboard patterns).
- Count announced as part of the option label ("sci-fi, 18 books").

---

## Surface 4 — Save-as-smart-shelf flow

R3.3. Appears when ≥1 filter is active (system facet and/or tag/author).

### Layout

- An **active-filter bar**: the applied filters as removable chips (`× ` per chip, 44×44 tap target, `aria-label="Remove filter sci-fi"`) + a result count ("→ 12 books") + a right-aligned **"Save as smart shelf"** `<Button variant="secondary" size="sm">`.
- Clicking Save reveals an inline name form (reuse the `CreateShelfForm` pattern in `ShelfPage`): text input (`inputClass`, `maxLength={100}`) prefilled with a generated name ("Reading · sci-fi"), `<Button variant="app" size="sm">Save</Button>` + ghost Cancel.

### Behavior

- Save → `POST /v1/smart-shelves { name, rule }` where `rule` is the active filter spec (`{ owned?, want?, readingStatus?, tag?, author? }`). Optimistic insert into the smart-shelf list (TanStack Query), like shelf create.
- On success: collapse the form, show a one-shot `<Callout>` "Smart shelf saved — it updates automatically." (dismissible), and the new smart shelf appears in Surface 5.

### States

| Element     | State            | Behavior                                                                      |
| ----------- | ---------------- | ----------------------------------------------------------------------------- |
| Save button | No active filter | Hidden (bar not shown)                                                        |
| Save button | Duplicate name   | 409 → inline red error under the name input (`text-red-500`), form stays open |
| Save button | Pending          | `loading` → "Saving…"                                                         |
| Name input  | Empty            | Save disabled (mirror `CreateShelfForm`)                                      |

### Edge cases

- **Filter that matches 0 books**: allow saving (an empty smart shelf is valid — it'll fill as books are added), but show "→ 0 books" so it's intentional.
- **Single-facet rule**: fine — a smart shelf can be just "Reading".
- **Name collision with a curated shelf**: smart and curated share the user's name space? **Decision needed** (see Open Questions) — default: separate namespaces, so "Sci-Fi" can exist as both; disambiguate by badge.

### Accessibility

- Active-filter chips: each remove `<button>` 44×44, labeled. The bar is `role="group" aria-label="Active filters"`.
- Save success Callout `role="note"` (built in), focus moves to it on appear for SR users.

---

## Surface 5 — Smart shelves alongside curated shelves

R3.3/R3.4. Both render in the existing `ShelfPage` shelf area; they must be **visually distinguishable**.

### Layout

- Reuse `ShelfSection` (horizontal scroll row + `SectionHeader`). Two differences in the header:
  - **Curated shelf** (PR #81): keep the existing **drag handle** (`DragHandle`) + "curated" affordance; draggable reorder unchanged.
  - **Smart shelf**: **no drag handle**; instead a leading **rule badge** — small pill `text-[10px] px-1.5 rounded-full border border-slate-200 dark:border-slate-700 text-slate-500` with a sparkle/rule icon + "rule". Header count reads from the live rule evaluation ("12 · auto").
- Ordering: curated shelves first (user-ordered, draggable), then a "Smart shelves" group, then "Unshelved / All books". (Or interleave — see Open Questions; default is grouped.)

### Behavior

| Element            | State                        | Behavior                                                                                                                                                                                     |
| ------------------ | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Smart shelf header | Default                      | Name (read-only or rename via `ShelfNameEditor`), rule badge, live count                                                                                                                     |
| Smart shelf        | Click count/chevron          | Navigate to a filtered view (replay the rule) — reuse the `onNavigate` chevron pattern                                                                                                       |
| Smart shelf        | Delete                       | `<Button variant="destructive" size="sm">` → `DELETE /v1/smart-shelves/:id`; no `DeleteShelfDialog` book-count warning needed (deleting a rule removes nothing) — a simple confirm is enough |
| Smart shelf        | Empty (rule matches 0)       | Row shows "No books match this rule yet." (not an error)                                                                                                                                     |
| Smart shelf        | Book added/changed elsewhere | Membership recomputes on next shelf fetch (no manual sync)                                                                                                                                   |

### Drag-and-drop

- Smart shelves are **not** part of the curated drag-reorder set (different ordering semantics). Don't let a curated drag drop onto a smart shelf or vice-versa. Keep `draggable` only on curated `SectionHeader`s.

### Accessibility

- The rule badge is **text "rule" + icon** — color-blind safe, and distinguishes smart from curated without relying on the presence/absence of a drag handle alone.
- Smart-shelf delete confirm: native confirm or a minimal dialog with focus trap (lighter than `DeleteShelfDialog`).

---

## Cross-cutting: Responsive summary

| Breakpoint | Filter bar              | Browse panel              | Title actions          |
| ---------- | ----------------------- | ------------------------- | ---------------------- |
| ≥ `lg`     | Inline chip row         | Inline panel under header | Buttons inline         |
| `sm`–`lg`  | Chip row wraps          | Inline panel              | Buttons inline         |
| < `sm`     | Horizontal-scroll chips | Full-width panel          | Fold into `MobileMenu` |

## Cross-cutting: Motion

| Element                  | Trigger | Animation                                                          | Duration                 | Easing  |
| ------------------------ | ------- | ------------------------------------------------------------------ | ------------------------ | ------- |
| Facet chip select        | click   | `transition-colors`                                                | Tailwind default (150ms) | default |
| Browse panel open        | open    | `scrollIntoView({behavior:"smooth"})` (reuse search-panel pattern) | —                        | —       |
| Smart-shelf save Callout | mount   | none (flat, per design system)                                     | —                        | —       |
| Card pills               | mount   | inherit `animate-fade-up` from the card                            | CSS-defined              | —       |

Respect `prefers-reduced-motion` (the app already gates the card stagger).

## Cross-cutting: Empty / loading / error

- **Loading**: reuse `ShelfSkeleton` for the grid; facet bar can render immediately (no data needed for the chips).
- **Error** (shelf/tags/smart-shelves fetch): reuse `ShelfErrorState` with retry.
- **Empty library**: `ShelfEmptyState` (facet bar + browse hidden until ≥1 book exists).
- **No smart shelves yet**: don't render an empty "Smart shelves" group header — show nothing (or a single muted "Save a filter to create a smart shelf" hint under the filter bar).

---

## Component inventory

| Component                                       | Reuse / New    | Notes                                                                                                                          |
| ----------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `ShelfBookCard`                                 | **Modify**     | Replace dot with pills (Surface 1)                                                                                             |
| `SegmentedControl`                              | Reuse          | Reading-status control in the **detail view**; the facet _bar_ is a chip row, not this (it's single-select-with-clear + icons) |
| `Button`                                        | Reuse          | `app` (save), `secondary` (save-as-smart-shelf), `ghost` (browse/clear), `destructive` (delete smart shelf)                    |
| `Callout`                                       | Reuse          | Save-success note; "suggested smart shelves" nudge (P1)                                                                        |
| `ShelfSection` / `SectionHeader`                | Reuse + extend | Add rule-badge variant; suppress drag handle for smart shelves                                                                 |
| `ShelfNameEditor`                               | Reuse          | Smart-shelf rename                                                                                                             |
| `MobileMenu`                                    | Reuse          | Fold title actions on `< sm`                                                                                                   |
| `BookCover`                                     | Reuse          | Unchanged                                                                                                                      |
| `FacetBar`                                      | **New**        | Surface 2                                                                                                                      |
| `FacetBrowsePanel`                              | **New**        | Surface 3 (combobox)                                                                                                           |
| `ActiveFilterBar` + `SaveSmartShelfForm`        | **New**        | Surface 4                                                                                                                      |
| `SmartShelfSection` (or `ShelfSection` variant) | **New/extend** | Surface 5                                                                                                                      |

## API touchpoints (for the implementing dev)

| Surface | Endpoint                                  | Status                                                         |
| ------- | ----------------------------------------- | -------------------------------------------------------------- |
| 2       | `GET /v1/shelf?owned/want/readingStatus`  | **Exists (Phase 1)**                                           |
| 3       | `GET /v1/shelf?tag=`                      | Phase 1 filter + add `tag` (Phase 2/3)                         |
| 3       | `GET /v1/tags`                            | Phase 2 (R2.4)                                                 |
| 3       | author distinct list                      | client-derived v1; endpoint P1                                 |
| 4/5     | `GET/POST/PATCH/DELETE /v1/smart-shelves` | **New (Phase 3)** — `SMARTSHELF#<id>` rule item, no `SMEMBER#` |

---

## Open Questions (non-blocking; resolve during build)

- **OQ1 (product):** Smart-shelf vs curated-shelf **name namespace** — shared or separate? Default: separate (badge disambiguates).
- **OQ2 (design):** Smart shelves **grouped** after curated shelves, or **interleaved** in one orderable list? Default: grouped (keeps "you arranged these" vs "these are rules" legible).
- **OQ3 (interaction):** When a **system facet** is active, do curated/smart shelf rows hide (flat grid) or stay and filter in place? Default: hide → flat grid (a facet is a library-wide view).
- **OQ4 (P1):** "Suggested smart shelves" — surface top-N tags as one-tap saves via `<Callout>`? Deferred to a fast-follow.

## Build sequence

1. Surface 1 (card pills) — independent, ships with Phase 1/2 UI; fixes the a11y bug.
2. Surface 2 (facet bar) — depends only on Phase 1 filters.
3. Surface 3 (browse) — depends on Phase 2 tags.
4. Surfaces 4 + 5 (smart shelves) — depend on the new `/v1/smart-shelves` endpoint; build together.
