# Spec: Edition Grouping — relate multiple editions of one work

**Status**: Draft
**Date**: 2026-07-10
**Owner**: Solo developer
**Jira**: BOOKSHELF-68 (epic BOOKSHELF-62 Feedback)
**Related**: `docs/specs/multiple-copies.md` (BOOKSHELF-60 — copies count, deliberately non-blocking), BOOKSHELF-40 (edition/format data — this spec takes the `format` label only), ADR-019 (independent entry attributes / dual-read / in-memory derivation), ADR-016 (analytics allowlist), `docs/specs/core-shelf.md`

## Problem

A user's relationship to a book is one DynamoDB item keyed `USER#<userId>` / `ENTRY#<isbn>`. Different **editions** of the same _work_ — the hardcover, the paperback, the audiobook — each carry a **different ISBN**, so they are addable today but land as **unrelated books** with no connection between them. Duplicate detection is per-ISBN (ADR-019), so nothing groups them.

User feedback (2026-07-01, rank 14): _"Options for adding different editions or multiple copies."_ The **copies** half shipped as BOOKSHELF-60 (a `copies` count on one ISBN). This spec is the **editions** half: seeing hardcover + paperback + audiobook of one work together, and switching between them.

The cost of not solving it: a user who owns two editions of a book they love sees clutter (two disconnected cards) instead of one coherent work, and there is no place to record _which_ format each edition is.

## Scope

**In scope**

- A **work-level grouping** that relates the editions (different ISBNs) of one work a user holds.
- A per-edition **`format`** label — `hardcover` / `paperback` / `ebook` / `audiobook` — enough to distinguish and switch between editions.
- **Book Details** UI to show a work's editions and switch between them.
- Grouping that is **automatic but visible and reversible**: the user is notified when editions are grouped, and can ungroup.

**Out of scope (deferred)**

- Richer edition metadata (publisher, page count, narrator, audio duration, publication date) — stays in **BOOKSHELF-40**.
- **Manual merge** of editions the derived key misses (translations, retitled reissues, box sets). P2 — the data model leaves the door open.
- **Collapsing the main shelf** into one card per work. V1 keeps each edition as its own card; grouping is presented on Book Details. Collapsing touches list rendering, counts, filtering, and smart shelves — a separate, larger change.
- Provider **work identifiers** (Open Library `/works/OLxxxxW`). We use Google Books today, which has no work ID; adopting a second provider is its own task.

## Goals / Non-goals

**Goals**

1. A user holding ≥2 editions of one work can **see them as one work** and switch between them from Book Details.
2. Each edition can carry a **format label** so "switch to the audiobook" is meaningful.
3. Grouping is **derived, additive, and reversible** — no key-schema change, no migration, and a wrong grouping is one click to undo.
4. The user is **never surprised**: a grouping is announced when it happens (mirrors the scanner "never add to a surprising place" principle).

**Non-goals**

- Per-copy attributes (that was decided against in BOOKSHELF-60) — copies and editions stay distinct concepts.
- Cross-user shared truth about a work — grouping is computed per user from their own shelf.
- Auto-detecting format from the provider — v1 lets the user set it; provider-sourced format is BOOKSHELF-40.

## Decision — a **derived work key**, overridable per entry

Two editions group when they share a **work key** derived from the shared `BOOK#<isbn>` metadata cache:

```
workKey = normalize(title) + "|" + normalize(primaryAuthor)
```

- **Derived by default, nothing stored.** Grouping is computed at read time from `title` + `authors[0]` — the same "derive it, don't store a GSI" posture as ADR-019's in-memory filtering. No `WORK#` entity for the happy path.
- **Overridable.** A single optional `workKey` attribute on the `ENTRY#<isbn>` item overrides the derived value when present. This is what makes grouping reversible (and, later, manually mergeable):
  - **Absent** (default / legacy) → server derives the key from metadata.
  - **Present** → used verbatim.
  - **Ungroup** an edition → write a unique solo value so it groups only with itself.
  - **Undo ungroup** → `REMOVE` the attribute so it falls back to the derived key.
  - **Manual merge** (P2) → write a shared explicit value across entries.

One additive, dual-read attribute covers all four behaviors with no migration.

### `normalize()` — a deliberately conservative heuristic

- lowercase, trim, collapse internal whitespace (reuse the `normalizeTag` shape);
- strip a leading article (`the ` / `a ` / `an `);
- drop a trailing `: subtitle` segment (so `Dune: Book One` ↔ `Dune` group; note `Foundation` vs `Foundation and Empire` keep distinct main titles and do **not** merge);
- primary author = `authors[0]`, lowercased with punctuation removed.

**If title or author metadata is missing, do not auto-group** — treat the edition as solo. A title-only key over-merges (many unrelated books share a title). The derived key is intentionally allowed to miss (translations, wildly different titles) rather than risk false merges; the notify-and-ungroup loop is the safety net the automatic key leans on.

### Why derived (not a `WORK#` entity or provider ID)

The ticket floated a `WORK#`-style entity **or** a derived key. Derived wins for v1: it needs no new item type, no migration, and no second provider, and it keeps the shared `BOOK#<isbn>` cache untouched. The known weakness — imperfect precision — is answered by making every grouping **visible and one-click reversible**, which is the behavior the product owner asked for.

## Data model

Two additive attributes on the existing `ENTRY#<isbn>` item. Both dual-read (absent → default), no backfill, key schema unchanged.

```jsonc
PK = USER#<userId>   SK = ENTRY#<isbn>
{
  "isbn": "9780547928227",
  "owned": true,
  "want": false,
  "copies": 1,
  "readingStatus": "finished",
  "tags": ["fantasy"],
  "format": "paperback",   // NEW — enum | absent; per-user edition label
  "workKey": null,         // NEW — absent = derive from metadata; present = override
  "addedAt": "...",
  "notes": null
}
```

- **`format`** — one of `hardcover` | `paperback` | `ebook` | `audiobook`; validated server-side (400 otherwise); absent reads as `null` ("unspecified"). Stored **per-user on the entry**, not on the shared `BOOK#<isbn>` cache: format is user-supplied today (Google Books gives no reliable format), and the endpoint checklist forbids putting user-controlled values in the shared, any-user-writable `BOOK#` key. If BOOKSHELF-40 later sources format reliably from a provider, it can graduate to shared metadata.
- **`workKey`** — optional bounded string (`WORK_KEY_MAX = 200`, matching the free-text-cap convention). Absent for all legacy and all auto-grouped entries; written only when the user ungroups (a solo sentinel) or, later, manually merges.

**Grouping is computed, not stored.** For a given entry, its siblings are the user's other entries whose _effective_ key (`workKey ?? deriveWorkKey(metadata)`) matches. A new `lib/works.ts` exports `deriveWorkKey(meta: BookMetadata): string | null`.

## API

Reuse existing routes; the endpoint checklist applies to every change (auth at router level, bounded/validated input, generic 500s, precise status codes).

- **Read (list)** — `GET /v1/shelf` entries gain `format` (additive; defaults to `null`). MCP `get_shelf` inherits it inline (ADR-002 preserved). The list does **not** collapse editions (see non-goals).
- **Read (detail)** — `GET /v1/shelf/:isbn` gains an `editions` array: the sibling entries sharing the effective work key (including self), each `{ isbn, format, owned, want, readingStatus, book }`. `editions.length > 1` is exactly "this is part of a multi-edition work." Computed from the user's entries + metadata (O(shelf size); shelves are small — acceptable, revisit only if it shows up in latency).
- **Write (format)** — extend `PATCH /v1/shelf/:isbn` to accept `format` (enum validated, or `null` to clear; 400 otherwise). No new route.
- **Write (ungroup / regroup)** — extend `PATCH /v1/shelf/:isbn` to accept `grouped: boolean`:
  - `false` → detach this edition (server writes a unique solo `workKey`; the client never sees the raw key).
  - `true` → re-attach (server `REMOVE`s the override so the derived key applies again).
    This keeps the `workKey` mechanism server-internal and gives the client a semantic verb.
- **Add-time grouping signal** — `POST /v1/shelf` response gains an optional `groupedWith: string[]` (ISBNs of existing editions the new book auto-joined), so the client can raise the "grouped with …" notification without recomputing. Empty/absent when the add is solo.

## UX

- **Add notification** — when a newly added book auto-joins an existing work (`groupedWith` non-empty), surface a non-blocking `<Callout>`/toast: _"Grouped with **{title}** — you now have N editions of this work."_ with **Keep separate** (→ `grouped:false`) and dismiss. Visible, reversible, never silent.
- **Book Details — edition switcher** — when `editions.length > 1`, show a segmented control of the work's editions labeled by `format` (the confirmed mockup: `○ Hardcover  ● Paperback  ○ Audiobook`). Selecting one navigates to that edition's details. Owned vs. wishlist editions are visually distinguished (shape/label, not color alone — color-blind guideline). Use `<Button>`/design-system components; no hover-only affordances.
- **Book Details — format control** — a small control to set/clear this edition's `format`. Defaults to "unspecified"; setting it is a plain `PATCH`.
- **Book Details — ungroup** — an "Ungroup this edition" action (in the overflow/`⋯`) → `grouped:false`, with an undo. Ungrouping pulls _this_ edition out (it becomes solo); splitting an arbitrary member set is P2.
- **Zero change** for the common single-edition case (`editions.length === 1`): no switcher, no badge.

## Requirements

**Must-have (P0)** — the feature is not viable without these:

- `format` enum on the entry: validated (400 on bad value), dual-read default `null`, travels inline on `GET /v1/shelf` and MCP `get_shelf`.
- `deriveWorkKey` with the conservative normalization above; **no auto-group when title or author metadata is missing**.
- `GET /v1/shelf/:isbn` returns the `editions` array (effective-key siblings).
- Auto-group on add with a **visible notification** (`groupedWith` → Callout/toast) and a **Keep separate** action.
- Ungroup / regroup via `PATCH … { grouped }`, with the `workKey` override persisted; legacy/absent `workKey` derives.
- Book Details edition switcher (format-labeled) + format control; RTL coverage; owned/wishlist distinguished by more than color.

**Nice-to-have (P1)** — fast-follow, core works without them:

- Provider-sourced format auto-fill on add (best-effort; user can still override) — overlaps BOOKSHELF-40.
- A small "N editions" affordance on the shelf **card** (not a collapse) linking into the work on Book Details.
- Analytics-driven precision tuning of `normalize()` (see metrics).

**Future considerations (P2)** — design must not foreclose:

- **Manual merge** of editions the derived key misses (write a shared explicit `workKey`). The override attribute already supports it.
- **Shelf collapse** to one card per work.
- Graduating `format` to shared `BOOK#` metadata once a reliable provider source exists.

## User stories

- As a reader who owns the paperback **and** the audiobook of a book, I want them shown as one work so my shelf reflects that I have one story in two forms.
- As a reader on a book's detail page, I want to switch to my other edition of it so I can jump between the print and audio versions.
- As a reader adding a second edition, I want to be told it was grouped (and be able to keep it separate) so grouping never happens behind my back.
- As a reader whose two _different_ books got grouped by mistake (same title, different work), I want to ungroup them in one click so a fuzzy match is never a trap.
- As a reader, I want to label an edition's format so "switch to the audiobook" is meaningful.

## Success metrics

Niche feature on a small user base — metrics are directional, and one doubles as a **quality signal**.

**Leading (days–weeks)**

- **Grouping precision proxy** — ungroup rate = ungroups ÷ auto-groups. A high rate means `normalize()` is over-merging; target **< 15%** ungroups. This is the primary health metric and the tuning input for P1.
- **Adoption** — # of users with ≥1 multi-edition work; # of edition switcher uses per such user.
- **Format set rate** — % of editions in a multi-edition work that get a `format` (leaving it "unspecified" weakens the switcher).

**Lagging (weeks–months)**

- Feedback item rank 14 stops recurring in the next feedback batch.
- No regression in shelf-load latency attributable to the detail-view `editions` computation.

Instrument via `track()` → `POST /v1/events` (ADR-016 — add each new event name to **both** the client `AnalyticsEvent` union and the server `ALLOWED_EVENTS` allowlist): `edition_grouped`, `edition_ungrouped`, `edition_switched`, `edition_format_set`.

## Acceptance criteria

- [ ] Two owned editions (different ISBNs, same derived work key) appear as one work on Book Details with a format-labeled switcher; the main shelf still lists each as its own card (v1 non-goal: collapse).
- [ ] Adding an ISBN that auto-joins an existing work raises a visible "grouped with …" notification with a Keep-separate action; grouping is never silent.
- [ ] Ungrouping an edition detaches only that edition (it becomes solo); undo re-attaches it; the decision survives reload (`workKey` override persisted).
- [ ] Books with missing title or author metadata are **not** auto-grouped.
- [ ] `format` validates to the four-value enum (400 otherwise), defaults to `null` for legacy/absent, and travels inline on `GET /v1/shelf` and MCP `get_shelf`.
- [ ] `ENTRY#<isbn>` key schema unchanged; no migration; legacy entries (no `format`, no `workKey`) read correctly (format `null`, key derived).
- [ ] Owned vs. wishlist editions in the switcher are distinguished by shape/label, not color alone; components come from the design system; RTL coverage for switcher, format control, and the add-time notification.
- [ ] New analytics events registered in both the client union and server allowlist (ADR-016).

## Open questions

- **Q1 (design)** — Edition switcher when two editions share a format (two paperbacks, different ISBNs — arguably a BOOKSHELF-60 _copies_ case, not editions): dedupe the label, show ISBN/year as a tiebreaker, or leave it? Lean: show publication year as the tiebreaker; resolve in frontend-design.
- **Q2 (design)** — Where does ungroup live at add time vs. on Book Details — is the add-notification's "Keep separate" enough, or does the switcher also need an inline ungroup per edition? Lean: notification + Book Details overflow action; revisit if it feels hidden.
- **Q3 (eng)** — Should the detail-view `editions` computation reuse the shelf's existing metadata batch-get, or is a dedicated `GET /v1/works/for-isbn/:isbn` cleaner once P2 merge lands? Non-blocking; inline on the entry response for v1.
- **Q4 (product)** — Do we auto-fill `format` from any Google Books signal at all (e.g., "Audiobook"/"Audible" hints in the title), or keep v1 strictly user-set to avoid wrong labels? Lean: strictly user-set in v1, provider auto-fill as P1 under BOOKSHELF-40.

## Timeline / dependencies

- **No dependency on BOOKSHELF-60** — the `copies` model was chosen precisely so it doesn't change the key schema and doesn't foreclose this; the two are orthogonal (copies = N of one ISBN; editions = related ISBNs).
- **Soft overlap with BOOKSHELF-40** — this spec takes only the `format` label; the rest of edition/format enrichment (and provider auto-fill) stays in 40 and can land after.
- Suggested phasing: **P0 as one PR** (data model + derive + detail switcher + add notification + ungroup), then P1 (provider format auto-fill, shelf-card affordance) once the ungroup-rate metric confirms the derived key's precision.
