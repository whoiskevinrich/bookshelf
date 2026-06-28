# Spec: Book Attributes, Tags & Auto-Shelves

**Status:** Approved
**Date:** 2026-06-27 (approved 2026-06-28)
**Author:** Solo developer
**Architecture:** [ADR-019](../adrs/019-book-attributes-tags-auto-shelves.md) (Accepted) — read first; this spec assumes its data-model decisions.
**Related:** [ADR-002](../adrs/002-shelf-api-response-shape.md) (shelf response shape / MCP-inline), PR #81 (named shelves), `docs/specs/core-shelf.md` (the Owned/Want model this supersedes)

---

## Problem Statement

A user's relationship to a book is currently a single mutually-exclusive flag — `owned` **or** `want` — with no way to record how far they've read, or to organize books by their own vocabulary. Readers think in overlapping facets ("sci-fi I own and am currently reading", "everything by this author", "want-to-read fantasy"), but the app forces one rigid state per book and only offers manually-curated named shelves. The result: the library doesn't reflect how people actually categorize their books, and the natural next features (a book-detail view, reading progress, organized browsing) have nowhere to attach.

This spec reshapes the core model so Owned/Want, reading status, and free-form tags are independent **attributes** on one book entry, and introduces **auto-shelves** — shelves that populate themselves from those attributes, from tags, or from book metadata (author) — without manual curation.

---

## Goals

1. **Owned/Want become independent attributes**, not a single enum — a book can carry owned, want, reading status, and tags simultaneously, all on the unchanged `ENTRY#<isbn>` item.
2. **Users can tag books** with their own vocabulary, with the system actively steering them away from near-duplicate tags (suggestions + normalization).
3. **Auto-shelves populate automatically** from attributes (Owned, Want, Reading, Finished, Unread), from any tag, and from author — zero manual membership, always current.
4. **Zero data loss / zero downtime migration** — existing Owned/Want entries map cleanly; the API is correct before, during, and after the backfill.
5. **MCP parity preserved** — attributes and tags travel inline on the entry so `get_shelf` answers facet questions ("what sci-fi do I own?") in one call (ADR-002).

---

## Non-Goals

- **Named shelf replacement.** The PR #81 user-created named shelves (explicit `SMEMBER#` membership, rename, drag-reorder) are **untouched**. Auto-shelves are a separate, computed concept and do not migrate, replace, or merge with them.
- **A book-detail view UI.** "Open a book for full details" and the reading-status badge UI are **sibling Active items** that consume this model; this spec defines the data + API they read/write, not their layout.
- **Auto-shelf visual placement.** Whether auto-shelves render alongside named shelves or in a separate "Smart shelves" section is **deferred to `/design-handoff`** (Q3). The API returns auto-shelves in a layout-agnostic shape so either design works.
- **A tag-reverse-lookup GSI.** Auto-shelves filter in-memory over the user's entries (ADR-019). No GSI in this version; revisit only if per-user entry counts reach the thousands.
- **Controlled/global tag taxonomy.** Tags are per-user free-text with suggestions from the user's own history — not a shared, curated vocabulary across users.
- **Arbitrary boolean auto-shelves** (OR, NOT, nested groups). A smart shelf may **AND together** a few facets (one system facet + one tag + one author — e.g. `reading AND sci-fi`), since it's saved from a combined filter state (R3.3). Anything richer — `OR`, negation, nesting — is a P2 future consideration.

---

## User Stories

### Attributes (Owned / Want / Reading status)

- As a reader, I want to mark a book I own **and** still track that I want a different edition, so my states aren't forced to be mutually exclusive.
- As a reader, I want **Owned** and **Want** to be mutually exclusive (a book is on my shelf or my wishlist, not both) — marking one automatically clears the other. _(Q1, revised 2026-06-28: mutually exclusive, enforced symmetrically.)_
- As a reader, I want to set a book's reading status (unread / reading / finished), so I can see progress across my library.
- As a screen-reader / color-blind user, I want reading status conveyed by **shape or text**, not color alone, so I can tell statuses apart (CLAUDE.md color-blind guideline).

### Tags

- As a reader, I want to add my own tags to a book (e.g. `sci-fi`, `book-club`, `favorites`), so I can organize by my own categories.
- As a reader, when I start typing a tag, I want suggestions from tags I've already used, so I don't create `scifi` when I already have `sci-fi`. _(Q2.)_
- As a reader, I want `Sci-Fi`, `sci-fi`, and `sci-fi` to be treated as the same tag, so casing/whitespace doesn't fragment my organization. _(Q2: normalization.)_
- As a reader, I want to remove a tag from a book, and when I remove the last one the book simply has no tags (no error).

### Auto-shelves

- As a reader, I want shelves that fill themselves — "Owned", "Want", "Reading", "Finished" — so I don't curate membership by hand.
- As a reader, I want a shelf for any tag ("everything tagged `fantasy`"), so my tags become browsable views.
- As a reader, I want a shelf of all books by a given author, so I can see my collection by author without tagging each one.
- As an MCP user, I want to ask "what sci-fi books do I own?" and get an answer in one tool call, so the assistant doesn't N+1 the API.

---

## Requirements

### Phase 1 — Attributes + Migration (P0)

**R1.1 — Entry shape.** The `ENTRY#<isbn>` item gains `owned` (bool), `want` (bool), `readingStatus` (`"unread"|"reading"|"finished"|null`). The **key `SK=ENTRY#<isbn>` and the duplicate-detection condition (`attribute_not_exists(PK)`) are unchanged.**

- [ ] `ShelfEntry` type + `toShelfEntry` mapper expose `owned`, `want`, `readingStatus`, `tags`.
- [ ] Given a legacy item with `status` and no `owned`/`want`, when it is read, then `toShelfEntry` derives `owned = status==="owned"`, `want = status==="want"` (dual-read fallback).

**R1.2 — Add book.** `POST /v1/shelf` accepts attributes on create. Back-compat: a `status` string in the body still works (maps to booleans) for one release.

- [ ] Given `{ isbn, owned:true }`, when added, then the entry has `owned:true, want:false, readingStatus:null`.
- [ ] Given `{ isbn, status:"want" }` (legacy client), when added, then the entry has `want:true, owned:false`.
- [ ] Duplicate isbn → **409** (unchanged).

**R1.3 — Update attributes (replaces status swap).** A `PATCH /v1/shelf/:isbn` updates any of `owned`, `want`, `readingStatus`.

- [ ] Owned/Want **mutually exclusive**: `PATCH { owned:true }` ⇒ `owned:true, want:false`; `PATCH { want:true }` ⇒ `want:true, owned:false` (symmetric, one write). Explicit `{ owned:true, want:true }` → **400**. `POST` with both true or neither → **400**.
- [ ] Given `PATCH { readingStatus:"reading" }`, then only reading status changes; owned/want untouched.
- [ ] `readingStatus` accepts only the enum or null → else **400**.
- [ ] Entry not found → **404**.

**R1.4 — Read / filter.** `GET /v1/shelf` returns the new fields inline and supports attribute filters.

- [ ] Response entries include `owned`, `want`, `readingStatus`, `tags`, plus a **derived, deprecated `status`** field for one release.
- [ ] `GET /v1/shelf?owned=true`, `?want=true`, `?readingStatus=reading` filter the result (generalizes today's `?status=` loop). Unfiltered path keeps cursor pagination.
- [ ] Each filter value validated → bad value **400**.

**R1.5 — Migration.** `apps/api/scripts/migrate-status-to-attributes.ts` (mirrors `migrate-isbn10-to-13.ts`) rewrites every `ENTRY#` item: `status` → `owned`/`want` booleans, `readingStatus:null`. Documented in a `docs/runbooks/` migration runbook.

- [ ] Idempotent (re-runnable); items already migrated are skipped.
- [ ] Runbook covers dev-then-prod order and verification query.

### Phase 2 — Tags (P0)

**R2.1 — Tag storage.** Tags are a DynamoDB **String Set** on the entry item, inline (rides the single-item read; MCP-inline parity).

**R2.2 — Caps + normalization** (endpoint checklist). Named constants near the write site:

- [ ] `TAGS_MAX_COUNT = 25` per entry; exceeding → **400**.
- [ ] `TAG_MAX_LENGTH = 50` chars per tag (post-normalization); exceeding → **400**.
- [ ] Normalize on write: trim, lowercase, collapse internal whitespace. `"  Sci-Fi "` → `sci-fi`.
- [ ] Empty/whitespace-only tag after normalization → rejected (not stored).

**R2.3 — Tag CRUD.** `PATCH /v1/shelf/:isbn/tags` adds/removes tags (mirrors the `/notes` sub-route pattern).

- [ ] Given an entry with 1 tag, when the last tag is removed, then the `tags` attribute is **`REMOVE`d** (not stored as an empty set, which DynamoDB disallows) — no error.
- [ ] Adding a tag that (after normalization) already exists is a no-op success, not a duplicate.
- [ ] Entry not found → **404**.

**R2.4 — Suggestions (anti-duplication).** _(Q2)_ The API exposes the user's distinct tag set for autocomplete.

- [ ] `GET /v1/tags` returns the user's distinct, normalized tags (derived from the entry scan — no separate registry in v1).
- [ ] The tag input suggests from this set before the user free-types a new tag.

### Phase 3 — Auto-shelves: three-tier model (P0 for tiers 1–3 below; author facet P1)

> Resolved 2026-06-28 (ADR-019 §2, Q3). Facets are **never auto-promoted to standing shelves** — that would make a large library noisy (hundreds of single-book author "shelves"). Split by how bounded/intentional each facet is.

**R3.1 — System facets → filter bar (P0).** **Owned, Want, Reading, Finished, Unread**, bounded and always present, computed from `owned`/`want`/`readingStatus` over the user's entries (in-memory filter; no GSI). These are the existing `GET /v1/shelf?owned=…&want=…&readingStatus=…` filters from Phase 1, surfaced as a filter bar.

**R3.2 — Ad-hoc tag/author facets → on-demand browse (P0 tag; P1 author).** Any tag or author is a **filter the user applies**, not a pre-listed shelf.

- [ ] `GET /v1/shelf` accepts `tag=<t>` (P0) and `author=<a>` (P1) filters, combinable with the system facets (e.g. `?readingStatus=reading&tag=sci-fi`).
- [ ] A browse affordance lists distinct tags/authors **with counts, type-ahead, sorted by frequency** — the long tail is searchable, **not rendered**. Reuses `GET /v1/tags` (R2.4) plus an equivalent distinct-author source from the `BOOK#<isbn>` cache.
- [ ] Nothing tag/author-derived is rendered as a standing shelf.

**R3.3 — Smart shelves → human-saved filter rules (P0).** The user saves a filter combination as a named standing shelf.

- [ ] From an active filter state, "Save as smart shelf" stores a **rule** (the filter spec) as a single `SMARTSHELF#<id>` item — **not** a membership list.
- [ ] `GET/POST/PATCH/DELETE /v1/smart-shelves` CRUD; a smart shelf's contents are computed on read by replaying its rule (same in-memory filter path). **Never writes `SMEMBER#` items.**
- [ ] Smart shelves render alongside curated (PR #81) shelves but are visually distinct (rule badge vs drag handle) and auto-update as entries change.
- [ ] _(Optional, P1)_ "Suggested smart shelves" — top few tags offered as one-tap saves; suggestions only, never standing shelves.

**R3.4 — API shape.** Auto-shelf/smart-shelf responses stay **distinct from** `GET /v1/shelves` (curated named shelves) so the client never merges the two. The visual layout (filter bar, browse panel, save flow, placement vs curated rows) is specced at `/design:design-handoff`; the model above is fixed.

### Cleanup (P0, after the transition release)

**R4.1 — Drop `status`.** _(Q4: one release.)_ After the web client ships its attribute migration, remove the `status` field from the API response and the dual-read fallback in `toShelfEntry`. Tracked as ADR-019 action item 8.

### Future Considerations (P2)

- Arbitrary boolean smart-shelf rules (OR / NOT / nested) — simple AND-combination ships in R3.3.
- A per-user tag registry item if deriving the distinct set from the entry scan proves costly.
- A tag-reverse-lookup GSI if per-user entry counts reach the thousands (ADR-019 Option B forward door).
- Tag rename/merge across all a user's entries.

---

## Success Metrics

**Leading (days–weeks):**

- **Migration integrity:** 100% of pre-migration `ENTRY#` items have `owned`/`want` booleans post-backfill; 0 entries with a `status` value but no booleans. (Verification query in the runbook.)
- **Tag adoption:** % of active users who add ≥1 tag within 30 days. Success ≥ 25%, stretch ≥ 40%.
- **Suggestion effectiveness (anti-duplication):** ratio of tags created via suggestion vs. free-typed; and count of near-duplicate tag pairs per user (e.g. Levenshtein ≤ 1) — target: near-duplicates stay near zero.
- **Auto-shelf usage:** % of shelf-page sessions that open at least one auto-shelf.

**Lagging (weeks–months):**

- **Engagement:** users with tags/reading-status set return more often than those without (retention delta).
- **Support/UX:** no rise in "lost my book / wrong shelf" reports through the migration window.

---

## Open Questions

All four ADR-019 questions are resolved (Q1 auto-clear, Q2 free-text + suggestions, Q3 deferred to design-handoff, Q4 one-release dual-emit). Remaining, non-blocking:

- **OQ1 (design):** auto-shelf placement + whether system auto-shelves are collapsible / hideable — **owned by `/design-handoff`** (Q3).
- **OQ2 (design):** tag-input affordance — chips vs. comma-separated, where suggestions surface. Design-handoff.
- **OQ3 (engineering, non-blocking):** does the `?owned=true&tag=X` combined filter ship in Phase 1, or wait until auto-shelves (Phase 3)? Default: single-facet filters in P1, combined filtering arrives with auto-shelves.
- **OQ4 (product, non-blocking):** should `readingStatus:"finished"` auto-imply `owned`? Default: **no** — keep facets independent (you can finish a borrowed book).

---

## Timeline / Phasing

Sequenced per ADR-019; each phase is independently shippable.

1. **Phase 1 — Attributes + migration** (P0). Entry shape, dual-read fallback, attribute `PATCH` with Q1 auto-clear, filters, backfill + runbook. Unblocks the sibling **Reading status UI** and **book-detail view** Active items.
2. **Phase 2 — Tags** (P0). String-set storage, caps/normalization, `PATCH …/tags`, `GET /v1/tags` suggestions.
3. **Phase 3 — Auto-shelves** (P0 system+tag, P1 author). Layout-agnostic API; visual placement at `/design-handoff`.
4. **Cleanup** (P0). Drop `status` + dual-read fallback one release after the web client migrates (Q4).

**Dependencies:** Phase 2 and 3 depend on Phase 1's entry shape. Author auto-shelves (R3.3) depend on the `BOOK#` metadata cache already being populated (it is). Design-handoff for surfacing should run in parallel with Phase 1/2 so Phase 3's UI isn't blocked.
