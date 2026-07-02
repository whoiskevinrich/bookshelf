# Handoff: Wishlist rename + Wishlist/Reading List nav links (BOOKSHELF-53 & 54)

**Date:** 2026-07-02
**Tickets:** [BOOKSHELF-53](https://whoiskevinrich.atlassian.net/browse/BOOKSHELF-53) (Wishlist: one name + persistent home) · [BOOKSHELF-54](https://whoiskevinrich.atlassian.net/browse/BOOKSHELF-54) (Reading List)
**Decisions of record:** `docs/adrs/021-wishlist-reading-list-taxonomy.md`

## Mission

Both tickets are **UI-only** (ADR-021) and share files, so do them as **one branch / one PR**:

1. **Rename the "want" state to "Wishlist" in every UI surface** (53). The wire value stays `want` — display-layer rename only.
2. **Add two nav entries** (53 + 54): **Wishlist** → `/shelf?facet=want`, **Reading list** → `/shelf?view=reading-list`. Deep-linking is already wired (see Base branch).

## Session start (project protocol)

- `/productivity:start` first. If in a `.claude/worktrees/` worktree, run `scripts/worktree-setup.ps1`, then `/dev` (real dev Cognito — **never** mock auth).

## Base branch ⚠️ read this first

These build directly on **BOOKSHELF-69** (URL-synced filter/view state + the reading-list composite), which is **committed but not merged**: branch `claude/serene-lichterman-ef9986`, commit `d58e953`.

- **Recommended:** merge BOOKSHELF-69 first (it's implemented, unit-tested, and live-verified against dev — see its ticket), then branch 53/54 off `main`.
- **Otherwise:** stack 53/54 on the 69 branch. Do **not** branch off a `main` that lacks 69 — the nav deep-links (`?facet=want`, `?view=reading-list`) rely on `ShelfPage` initializing filter/view state from the URL, which 69 adds. Without it the links land on an unfiltered shelf.

Already done by 69 (do not rebuild): `parseFacet`, `isReadingListEntry`, `ReadingListBar`, and `ShelfPage` reading `?facet`/`?tag`/`?view` via `useSearchParams`.

## Scope & current state

### 1. "Want" → "Wishlist" rename (BOOKSHELF-53)

Keep `SystemFacet`'s value `"want"`, the entry attribute `want`, smart-shelf rules, and all API payloads **unchanged** — this is labels only. Change these UI surfaces (find them by grepping `apps/web/src` for the string `Want`, don't trust line numbers):

- `apps/web/src/components/shelf/ShelfFilterControls.tsx` — `FACETS` array label `"Want"` → `"Wishlist"`. `facetLabel()` derives from `FACETS`, so the facet chip, the `ActiveFilterBar` chip, and the smart-shelf default name all follow automatically.
- `apps/web/src/components/shelf/ShelfBookCard.tsx` — the state pill that reads "Want".
- `apps/web/src/pages/BookDetailPage.tsx` — the segmented-control option that reads "Want".
- Add/confirm buttons already say "Wishlist" (`BookSearch.tsx`, `ScanModal` confirmations) — verify they match.

**Acceptance:** `grep -rn "Want" apps/web/src` returns no user-facing UI strings (only wire values / identifiers). Analytics (ADR-016): if any event `name` contains `want`, leave the wire name; only change display copy.

### 2. Nav links (BOOKSHELF-53 + 54)

`apps/web/src/components/AppHeader.tsx` — add two `NavLink`s to **both** the inline nav (`sm` and up, `navLinkClass`) and the `MobileMenu` panel (`panelLinkClass`):

- `<NavLink to="/shelf?facet=want">Wishlist</NavLink>`
- `<NavLink to="/shelf?view=reading-list">Reading list</NavLink>`

**Design nuance to handle:** `NavLink`'s `isActive` matches on **path only**, so "My Library", "Wishlist", and "Reading list" (all `/shelf`) would all show active simultaneously. Decide active state by query param instead (read `useSearchParams` / `useLocation().search` and compute the active-link class yourself) so exactly one lights up. This is the main non-trivial bit of the two tickets.

## Guardrails (CLAUDE.md non-negotiables)

- Buttons via `<Button>`; nav links follow the existing `AppHeader` link classes. Muted text ≥ `text-slate-600 dark:text-slate-400`. No hover-only affordances. No mock auth.
- Run `pnpm preflight` (includes `pnpm qa:guards`) before the PR.

## Verification

- Unit/RTL: update `ShelfFilterControls.test.tsx` (the FacetBar test asserts the label `"Want"` — flip it to `"Wishlist"`). Add an `AppHeader` test for the two links + active-state logic.
- **Live QA against dev** (recommended — the shelf is auth-gated so tests alone don't prove the nav wiring). Use the dev QA account (creds from Kevin — not stored here). Two gotchas learned on BOOKSHELF-69:
  - Programmatic form-fill does **not** update React's controlled inputs, so the login form won't submit from tooling. Authenticate by calling the app's `signIn` in the page context: `const m = await import('/src/lib/auth.ts'); await m.signIn(email, password);` then reload to `/shelf`.
  - The QA account is empty. Seed a couple of books via `import('/src/lib/api-client.ts')` (`addToShelf(isbn,'owned'|'want',meta)`, valid EAN-13 checksum required) to see the Wishlist/Reading-list views populate, then `removeFromShelf` to clean up.

## Definition of done

- One term ("Wishlist") across all UI surfaces (grep clean); wire value `want` untouched.
- Wishlist + Reading list reachable in one click from desktop nav and mobile menu; exactly one nav item shows active per view.
- RTL coverage updated/added; `pnpm preflight` green.
- PR opened; ticket references this handoff + ADR-021.
