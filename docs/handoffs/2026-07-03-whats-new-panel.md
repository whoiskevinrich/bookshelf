# Handoff: What's New panel + unseen dot (BOOKSHELF-75)

**Date:** 2026-07-03
**Ticket:** [BOOKSHELF-75](https://whoiskevinrich.atlassian.net/browse/BOOKSHELF-75) (What's New panel + unseen dot) · Epic [BOOKSHELF-72](https://whoiskevinrich.atlassian.net/browse/BOOKSHELF-72)
**Spec:** `docs/specs/whats-new.md` (build to **P0-3 + P0-4**)
**Branch:** `BOOKSHELF-75-whats-new-panel` (already created off `main` @ `404c230`; this handoff is its first commit)

## Mission

Build the **What's New panel** — a sparkle icon in `AppHeader` that opens a date-grouped feed of recent release highlights, with an **unseen dot**. This is the visible payoff of the epic. Passive, never interrupts. UI-only; no backend.

## Session start (project protocol)

- `/productivity:start` first.
- You're in a `.claude/worktrees/` worktree → run `scripts/worktree-setup.ps1` (copies `.env.local`), then `/dev` (real dev Cognito — **never** mock auth).

## Base — already done (do NOT rebuild)

Everything upstream is **merged to `main`**:

- **#101 (BOOKSHELF-73)** — the `Release-Note:` convention + PR template / `pr-workflow.md` / CLAUDE.md Phase 4 step.
- **#102 (BOOKSHELF-74)** — `scripts/gen-whats-new.mjs` generates `apps/web/public/whats-new.json` from git history at build time. Wired into the web `build` and `dev` scripts. The JSON is a **gitignored build artifact**.

## Data contract — `whats-new.json`

The SPA consumes a static asset at **`/whats-new.json`** (served from `apps/web/public/`). Shape:

```jsonc
{
  "generatedAt": "2026-07-03", // YYYY-MM-DD or null (derived from newest commit date)
  "entries": [
    { "id": "a1b2c3d", "date": "2026-07-03", "note": "Find any book you own by title or author." }
  ]
}
```

- `entries` is **newest-first**. `id` = short commit SHA (stable, unique — used for seen-tracking). `date` = `YYYY-MM-DD` (the grouping key). `note` = the one human sentence.
- **⚠️ The feed is currently EMPTY** — no `Release-Note:` trailers exist in history yet. Launch seed content is **BOOKSHELF-76** (separate ticket). To develop/test the UI, temporarily drop a fixture `apps/web/public/whats-new.json` with 3–4 entries (it's gitignored, so it won't be committed), or regenerate after writing a trailer. Do **not** commit a populated `whats-new.json`.

## What to build (acceptance — spec P0-3 + P0-4)

- [ ] Sparkle icon in `apps/web/src/components/AppHeader.tsx`, **left of `<ThemeToggle />`**, present in BOTH the inline nav (`nav.hidden sm:flex`, ~line 71) AND the mobile cluster (`div.flex sm:hidden`, ~line 90). Follow the `ThemeToggle` placement pattern.
- [ ] Clicking opens a panel (popover/dropdown anchored to the icon): entries **grouped by date, newest first**, one sentence each.
- [ ] **Unseen dot** on the icon when unseen entries exist; a **"New" pill** on unseen entries. Both clear once the panel is opened.
- [ ] Panel dismissible by click-outside and `Esc`; `aria-label` on the icon button; keyboard-navigable.
- [ ] Empty feed → no dot, panel shows a graceful empty state. **Missing/broken `whats-new.json` must never break the header** (error boundary + fallback — app async rule).
- [ ] Light + dark mode. Mobile-reachable and readable.

## Design decision — terracotta "new" accent (Q1 RESOLVED)

Kevin chose **terracotta** (the `c-coral` family) as the app's first non-error/success accent. Values:

| Use | Light | Dark (tune against `slate-900`) |
| --- | --- | --- |
| Unseen dot | `#D85A30` | `#D85A30` (stays visible on dark) or a touch lighter `#F0997B` |
| "New" pill bg | `#FAECE7` | `~coral-900/30` (e.g. `#4A1B0C`/30) |
| "New" pill text | `#712B13` | `#F0997B` |
| "New" pill border | `#F0997B` | `#712B13` |

**Two required doc updates in this PR:**

1. **`docs/design-system.md`** — add a "new / notification" accent row under **Semantic colors** (it's additive, signals state not brand). This is the app's first accent beyond red/green — record it deliberately with the light/dark values above.
2. **`docs/specs/whats-new.md`** — mark **Q1 resolved** (terracotta) in Open Questions.

## Seen-tracking (P0-4)

- Store the **`id` of the newest entry present when the panel was last opened** in `localStorage`. On load, entries appearing before that id in feed order are "unseen" → dot + "New" pill.
- **Reuse `apps/web/src/hooks/useLocalStorage.ts`** — `useLocalStorage<string>(key, initial, parse)`. It persists `String(value)` and falls back on malformed values, so pass `parse = (raw) => raw || null`. Key suggestion: `"whats-new:last-seen-id"`.
- **First-visit (no stored value)** → mark all seen (no dot on first load) — spec Q2 lean. Document the choice inline.

## Design-system grounding (`docs/design-system.md`)

- Surfaces: panel `paper-50`, page `paper-100`, insets `paper-200`, borders `paper-300`/`paper-400`. Text: `slate-*` (muted floor **`text-slate-600 dark:text-slate-400`** — never `text-gray-*`).
- Radius: containers `rounded-2xl`, buttons `rounded-lg`, pills `rounded-full`. Icons: Tabler-style already used in `components/icons/`.
- **Accessibility guards (CLAUDE.md):** state not by color alone (the dot is a shape + the "New" text pill satisfies this); any spinner needs `role="status"` + `aria-label`; use `<Button>` for any button, never raw `bg-*` classes.

## Data fetching

`/whats-new.json` is a **static public asset, not an API route** — fetch it directly (plain `fetch` in an effect, or a small `@tanstack/react-query` query since the app already uses react-query). Don't route it through `lib/api-client.ts` (that's for the authed API). Treat a 404/parse error as "empty feed."

## Verify

- Unit: extend `AppHeader.test.tsx` and/or add a `WhatsNewPanel.test.tsx` (Vitest + RTL) — dot visibility vs. `localStorage`, open clears the dot, empty-feed state, grouping.
- Manual: drop a fixture `whats-new.json`, check the panel in light/dark and on mobile (`preview_resize`). Confirm the dot clears after opening and stays clear on reload.
- `pnpm preflight` before the PR.

## PR

- **This IS user-facing — dogfood the convention.** Add a `Release-Note:` trailer, e.g.:
  `Release-Note: A new "What's New" panel shows the latest improvements — tap the sparkle in the header.`
- After merge, follow-ups: **BOOKSHELF-76** (seed the feed so it's non-empty), then P1 (richer entries/icons, standalone `/whats-new` page).

## Open questions (non-blocking)

- **Q2 first-visit:** lean mark-all-seen (above). Confirm it feels right.
- Panel entry richness is **P0 = one sentence only**; bold title + icon per entry is **P1**, don't build it here.
