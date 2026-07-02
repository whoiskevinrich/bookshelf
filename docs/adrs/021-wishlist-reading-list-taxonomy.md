# ADR-021: Wishlist Naming, System-Shelf Entry Points, Reading List Semantics & Sort Persistence

**Status**: Accepted
**Date**: 2026-07-02
**Deciders**: Solo developer
**Related**: ADR-019 (book attributes & three-tier auto-shelves), ADR-002 (shelf API shape / MCP inline), ADR-016 (client analytics events); Jira BOOKSHELF-53 (wishlist naming + home), BOOKSHELF-54 (Reading List), BOOKSHELF-57 (sort + filters), epic BOOKSHELF-62 (Feedback)

## Context

Three items from the 2026-07-01 user-feedback batch all touch the same surface — **what the built-in "shelves" are, what they're called, and how a user reaches them** — so they are decided together to avoid conceptual collision (the tickets explicitly cross-warn about it):

- **BOOKSHELF-53** — the "want" state is named inconsistently: the add buttons and scan confirmations say **"Wishlist"**, while the facet chip, card state pill, and the `BookDetailPage` segmented control say **"Want"** (`ShelfFilterControls.tsx`, `ShelfBookCard.tsx`, `BookDetailPage.tsx`). There is also no persistent entry point — the only way to the wishlist is the "Want" facet chip or a hand-made smart shelf.
- **BOOKSHELF-54** — users want a **"Reading List"**. Reading-status facets shipped (ADR-019 / PR #82), but nothing called "Reading List" exists out of the box and the bare facet doesn't read as one.
- **BOOKSHELF-57** — users want **sort** (title, author, release date, date added). No sorting exists today; a sort control needs a home for its persisted choice.

ADR-019 set the governing constraint: **auto-shelves are computed rules and a facet is never auto-promoted to a standing shelf.** System facets live in a filter bar; smart shelves are _human-created_ `SMARTSHELF#` rule items (cap 50). Any "built-in shelf" solution must respect that principle rather than special-casing new stored shelf entities.

## Decision

### 1. Terminology — "Wishlist" everywhere in the UI; `want` stays the wire value

Every user-facing surface reads **"Wishlist"**: the facet label, the card state pill, the `BookDetailPage` control, and all confirmations — matching the add buttons that already say it. Grep for the string "Want" in UI strings must return nothing after the change.

**The internal/wire key stays `want`.** `SystemFacet`'s value remains `"want"`, the entry attribute stays `want: boolean` (ADR-019), and smart-shelf rules keep persisting `{ want: true }`. Renaming the wire value would force a migration of every stored `SMARTSHELF#` rule and a breaking change to `POST /v1/smart-shelves` (`rule.want`) and the MCP `get_shelf` contract — all to change a label. So this is a **display-layer rename only**: change `FACETS` labels + `facetLabel()`, the pill, and the detail control; leave types, attributes, rules, and API payloads untouched.

Analytics (ADR-016): rename only UI strings, never the allowlisted event `name` values. Audit `AnalyticsEvent` / `ALLOWED_EVENTS` for any `*want*` names and leave the wire names as-is (renaming them is a cardinality/allowlist change for zero user benefit).

### 2. Entry points — nav deep-links to pre-filtered views (mockup Option A)

Add **"Wishlist"** and **"Reading list"** entries to the app nav (`AppHeader` inline nav + `MobileMenu`). Each is a **deep link that opens the shelf with a view pre-applied** — Wishlist → the `want` facet; Reading list → the composite view in §3. No new data type, no backend, no stored shelf entity.

This keeps ADR-019 intact: facets stay filters, nothing is promoted to a standing `SMEMBER#`/`SMARTSHELF#` shelf. It is strictly cheaper than the two alternatives considered (a "system-shelves strip" of built-in cards on the shelf page; seeded non-deletable smart shelves — which would need a system flag, a 50-cap exemption, and an ADR-019 amendment).

**Enabling change:** `ShelfPage` currently holds `facet`/`tag` in `useState` only. To honor a deep link it must **initialize filter state from the URL** (e.g. `?facet=want` or `?view=reading-list`) on mount and keep the URL in sync. This is the one shelf-page change the entry points require.

### 3. Reading List — a client-computed composite view: _currently reading + unread you own_

"Reading list" = `readingStatus === "reading"` **OR** (`owned === true` **AND** not finished, i.e. `readingStatus` is `"unread"` or null). It is the "what to read next from books I already have" queue — deliberately **distinct from Wishlist** (books you don't own yet), so the two never overlap.

This union is **not expressible by the current `ShelfFilter`** (single `readingStatus` value + `owned`/`want` booleans, AND-combined server-side). Rather than add OR-composition to the API filter, Reading List is a **named client-side view**: the full shelf is already loaded client-side (ADR-019 / `flattenShelf`), so `ShelfPage` computes the predicate over loaded entries when `view=reading-list`. No new endpoint, no server filter change, and it composes with the library search (BOOKSHELF-52) and sort (§4) like any other view.

Because it is computed, not stored, it is inherently "not accidentally deletable" and needs no membership — satisfying BOOKSHELF-54's acceptance criteria via ADR-019 mechanics.

### 4. Sort preference — persisted per-user, server-side

The sort choice (field + direction) persists **per user, across devices**, not per session. This is the batch's **only** new backend surface: a single per-user preferences item and a small read/write path.

- Storage: one item per user, `PK = USER#<userId>`, `SK = PREF#SHELF` (a singleton), holding `{ sortField, sortDir }`. No GSI; single-item read, mirrors ADR-019's cost posture.
- API: `GET /v1/preferences` + `PUT /v1/preferences` (or `PATCH`), behind router-level `authMiddleware`. Per the CLAUDE.md **new-endpoint checklist**: validate `sortField` against an allowlist (`title | author | releaseDate | addedAt`), `sortDir` ∈ `asc | desc`; reject anything else with **400**; generic 500 strings.
- Sort execution stays client-side over the loaded library (like the facets), so only the _preference_ round-trips — not the sorted data.

## Consequences

**Easier / cheaper:**

- BOOKSHELF-53 and BOOKSHELF-54 become **UI-only** — nav entries + a URL-driven filter init + one client-side predicate. No API, no migration, no ADR-019 amendment.
- Wishlist rename is a label-only change; stored rules, entry attributes, and MCP payloads are untouched, so there is zero data risk.
- Reading List can't collide with Wishlist by construction (owned-unread vs unowned).

**Harder / new work:**

- `ShelfPage` gains URL-synced filter state (new, but small) — the enabling change for deep links.
- BOOKSHELF-57 introduces the **first user-preferences endpoint** (`/v1/preferences` + `PREF#` item). It is net-new API surface and must clear the endpoint checklist. It's the only part of this batch that isn't free.

**To revisit:**

- If a future feature needs server-side OR-composed filters (e.g. MCP asking for the reading list in one call), reconsider extending `ShelfFilter` rather than keeping Reading List client-only. For now MCP parity is unaffected — Reading List is a web view, not an API concept.
- If more per-user preferences appear (default view, density), generalize `PREF#SHELF` into a small preferences map rather than one item per concern.

## Open (implementation) items

1. Rename UI strings "Want" → "Wishlist" (`ShelfFilterControls` `FACETS`/`facetLabel`, `ShelfBookCard` pill, `BookDetailPage` control); keep `SystemFacet` value `"want"`. Grep confirms no stray "Want" UI string remains.
2. `ShelfPage`: initialize `facet`/`tag`/`view` from the URL query and keep the URL in sync; add the `reading-list` composite predicate.
3. `AppHeader` + `MobileMenu`: add "Wishlist" and "Reading list" nav entries (deep links).
4. `/v1/preferences` route + `PREF#SHELF` item + `GET`/`PUT` hooks; sort control on the shelf page reads/writes it; sort allowlist validation.
5. Audit `AnalyticsEvent`/`ALLOWED_EVENTS` for `*want*` names — leave wire names, confirm no UI copy leaks.
