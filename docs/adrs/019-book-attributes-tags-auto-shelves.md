# ADR-019: Book Attributes, Tags & Auto-Shelves — Core Data-Model Reshape

**Status:** Accepted
**Date:** 2026-06-27 (accepted 2026-06-28)
**Deciders:** Solo developer
**Context:** Epic "Book data model: tags, attributes & auto-shelves" (`todo/TASKS.md`); supersedes the Owned/Want `status` enum from `docs/specs/core-shelf.md` / ADR-002. Foundational ADR for the **Book Detail + Data Model** block.

---

## Context

Today a user's relationship to a book is a single DynamoDB item:

```
PK = USER#<userId>   SK = ENTRY#<isbn>
{ isbn, status: "owned" | "want", addedAt, notes }
```

`status` is a **mutually-exclusive enum**. "Owned" and "Want" are distinct states (CLAUDE.md: _"Wishlist vs. Owned: states are distinct, never conflated"_). Moving a book between them is a `status` swap (`PATCH /v1/shelf/:isbn`). Duplicate detection relies on the single `ENTRY#<isbn>` key: one entry per `(user, book)`, enforced by `ConditionExpression: attribute_not_exists(PK)`.

Three coupled backlog items want to reshape this:

1. **Books support user tags** — free-text/controlled tags on an entry, with count/length caps.
2. **Owned & Wishlist become book attributes → automatic shelves** — reframe Owned/Want from a single enum into independent attributes that materialize as system "auto-shelves".
3. **Auto-shelves from tags and/or metadata** — rule-defined virtual shelves ("all tagged `sci-fi`", "all by Brandon Sanderson") that update automatically.

These three share one entry-item shape, one duplicate-detection key, and one migration, so they are decided together here. Two things they must **not** break:

- **Named shelves already exist** and are unrelated to this change. PR #81 shipped user-created shelves with **explicit membership** (`SHELFMETA#<shelfId>` + `SMEMBER#<shelfId>#<isbn>`), rename, drag-reorder, and delete. "Auto-shelves" are a **new, computed** concept — rule-defined, zero stored membership — and must be clearly distinguished from these manual shelves, not merged into them.
- The shared `BOOK#<isbn>` metadata cache (title, `authors[]`, cover, year, description) is keyed by ISBN only and shared across all users. Author-based auto-shelves read from it; nothing user-controlled may be written there.

### Constraints / forces

- **Solo dev, free-tier economics.** DynamoDB on-demand, scale-to-zero (ADR-001). Per-user data volumes are small (tens to low-hundreds of books). Prefer single-item reads and **no new GSI** until a query pattern actually hurts — a GSI is a standing cost and a migration of its own.
- **MCP parity (ADR-002).** Whatever the web sees, the MCP `get_shelf` tool should get in one call. Attributes and tags must travel **inline on the entry**, not require N follow-up lookups.
- **Two-way-door bias.** The entry item is read in full on every shelf view today; adding fields to it is cheap and reversible. Standing infrastructure (GSIs, materialized membership) is not.
- **Endpoint checklist (CLAUDE.md).** Every new text field written to DynamoDB needs a named max-length cap; tags need both a per-tag length cap and a per-entry count cap.

---

## Decision

Three coordinated decisions:

### 1. Entry shape: independent attributes + an inline tag set, same key

Keep **one item per `(user, book)` at `SK=ENTRY#<isbn>`** — the duplicate-detection key is **unchanged**, which is the single most important property of this design. Replace the `status` enum with independent fields and add an inline tag set:

```jsonc
PK = USER#<userId>   SK = ENTRY#<isbn>
{
  "isbn": "9780553381351",
  "owned": true,            // independent boolean (was status === "owned")
  "want":  false,           // independent boolean (was status === "want")
  "readingStatus": "reading", // "unread" | "reading" | "finished" | null
  "tags": ["sci-fi", "favorites"], // DynamoDB String Set; capped
  "addedAt": "2026-06-27T...Z",
  "notes": null
}
```

- `owned` / `want` become two boolean fields (not a single enum), but are **mutually exclusive** by enforced product rule — owned XOR want (see Q1, revised). Reading status and tags are the genuinely independent facets that "materialize as auto-shelves" alongside them, all from the same item.
- `readingStatus` is added now (the backlog "Reading status" item lands with this model) as a nullable enum.
- `tags` is a **DynamoDB String Set** stored on the entry — it rides along on the single-item read for free, satisfying MCP-inline parity with zero extra round-trips. Tags are normalized (trim, lowercase, collapse whitespace) and **capped**: `TAGS_MAX_COUNT = 25` per entry, `TAG_MAX_LENGTH = 50` chars each (named constants near the write site, per the endpoint checklist).

### 2. Auto-shelves are computed rules, in three tiers — never auto-promoted to standing shelves

An auto-shelf is a rule evaluated against the user's entry set; it has **no `SMEMBER#` items**. The original "one shelf per tag, one per author" framing does not scale — a large library (hundreds of books → dozens of tags, hundreds of mostly single-book authors) would generate hundreds of standing shelves, which is noise. So facets are split into **three tiers by how bounded and how intentional each is** (refined 2026-06-28, resolving Q3):

- **System facets** (bounded, always on): `Owned`, `Want`, `Reading`, `Finished`, `Unread` — derived from `owned`/`want`/`readingStatus`. Surfaced as a **filter bar**. These replace today's `?status=` filter.
- **Ad-hoc facets** (unbounded → **on-demand only**): any tag, any author. Surfaced as a **type-ahead browse** with counts — **nothing is pre-listed as a shelf**. The long tail stays searchable, not rendered, so library size stops mattering. Tag facets read the entry's `tags`; author facets join the `BOOK#<isbn>` cache.
- **Smart shelves** (human-created, few): the user **saves a filter combination** (e.g. `readingStatus=reading AND tag=sci-fi`) as a named standing shelf. What's stored is the **rule**, not membership — so it auto-updates and needs no `SMEMBER#` rows. A smart shelf is one small `SMARTSHELF#<id>` item holding a filter spec; membership is computed on read like every other facet. This is the iTunes/Goodreads smart-playlist model and stays distinct from PR #81's hand-curated `SMEMBER#` shelves (which carry a drag handle; smart shelves carry a rule badge).

The principle: **never auto-promote a facet to a standing shelf** — tags/authors are filters you reach for, not a wall you scroll. Discovery without noise is fine via _suggested_ smart shelves (top tags, one tap to save), but suggestions, never standing shelves.

Evaluation happens **server-side over the user's full `ENTRY#` query result, filtered in memory** — generalizing the existing `?status=` paginate-and-filter loop in `queryBookEntries`. **No GSI** is introduced; a saved smart-shelf rule is far cheaper than materializing membership per tag/author. At current per-user scale (tens–hundreds of items) a single `Query` on the `ENTRY#` prefix is one RCU-cheap call; filtering in the Lambda is free. The API exposes filters (e.g. `GET /v1/shelf?owned=true&tag=sci-fi`) so both web and MCP share one path.

### 3. Migration: additive field rewrite, one-off backfill, dual-read transition

- **Backfill script** `apps/api/scripts/migrate-status-to-attributes.ts` (mirrors `migrate-isbn10-to-13.ts`) rewrites every `ENTRY#` item: `status==="owned"` → `owned:true, want:false`; `status==="want"` → `owned:false, want:true`; sets `readingStatus:null`, leaves `tags` absent. Documented in a `docs/runbooks/` migration runbook.
- **Dual-read back-compat** in `toShelfEntry`: if a legacy item still has `status` and lacks `owned`/`want`, derive the booleans on read, so the API is correct **before** the backfill completes (deploy → backfill → drop the fallback later).
- **Additive API response**: `GET /v1/shelf` entries gain `owned`, `want`, `readingStatus`, `tags`. `status` is kept as a **derived, deprecated** field for one release so the web client can migrate, then removed (tracked as a follow-up cleanup task).

---

## Options Considered

The load-bearing choice is **how attributes + tags are stored and how auto-shelves are queried**. Three coherent shapes:

### Option A: Inline attributes + inline tag set, compute auto-shelves in-app ✓

Booleans + `readingStatus` + a `tags` String Set on the single `ENTRY#` item; auto-shelves are in-memory filters over the entry query. No GSI, no new item types.

| Dimension        | Assessment                                                              |
| ---------------- | ----------------------------------------------------------------------- |
| Complexity       | **Low** — additive fields on an item already read in full               |
| Cost             | **$0** — no GSI, no extra items, one Query per shelf view               |
| Scalability      | Good to ~low-thousands of entries/user; in-memory filter is the ceiling |
| Team familiarity | High — generalizes the existing `?status=` loop                         |

**Pros:** Dedup key unchanged; MCP-inline for free; smallest migration; fully reversible. Matches the data's actual scale.
**Cons:** "All books with tag X" scans the user's entries (not a direct index lookup) — fine at this scale, not at 10k+ entries/user. Tag String Set can't be empty (must `REMOVE` the attribute when the last tag is deleted).

### Option B: Generic attribute/tag items + GSI for reverse lookup

Store tags/attributes as separate items (`SK=ENTRYTAG#<isbn>#<tag>`, `SK=ENTRYATTR#<isbn>#owned`) and add a GSI (`GSI1PK=USER#<userId>#TAG#<tag>`) so "all books tagged X" is a direct query.

| Dimension        | Assessment                                                            |
| ---------------- | --------------------------------------------------------------------- |
| Complexity       | **High** — multi-item writes per entry, GSI projection, fan-out reads |
| Cost             | GSI storage + write amplification on every tag change                 |
| Scalability      | Excellent — direct index lookup regardless of shelf size              |
| Team familiarity | Medium                                                                |

**Pros:** Native query-by-tag/attribute; scales indefinitely.
**Cons:** Solves a scale problem we don't have (YAGNI). Breaks MCP-inline parity (tags no longer ride the entry read). Write amplification + a GSI migration for every tag edit. Heaviest of the three.

### Option C: Auto-shelves as materialized membership (reuse `SMEMBER#`)

Treat auto-shelves like named shelves: maintain `SMEMBER#` rows for system/tag shelves, updated on every attribute/tag write.

| Dimension        | Assessment                                            |
| ---------------- | ----------------------------------------------------- |
| Complexity       | **High** — every write must reconcile membership rows |
| Cost             | Write amplification; storage for derived data         |
| Scalability      | Read-fast, write-heavy                                |
| Team familiarity | High (pattern exists)                                 |

**Pros:** Auto-shelf reads reuse the exact named-shelf read path; one mental model.
**Cons:** Stores derived state → consistency burden (every attribute/tag/author-metadata change must fan out to membership; author changes come from the _shared_ `BOOK#` cache, which no single user write owns — author-based auto-shelves can't be materialized per-user cleanly). Conflates auto-shelves with manual shelves, the exact distinction we're trying to keep crisp.

---

## Trade-off Analysis

The deciding factors are **scale** and **MCP parity**. Per-user shelves are small and read in full on every view, so an in-memory filter (Option A) is effectively free and keeps tags inline for MCP. Option B's GSI buys index-scale lookups we won't need for a long time, at the cost of breaking inline reads and a heavier migration — a premature optimization. Option C stores derived state, and author-based auto-shelves (sourced from the shared `BOOK#` cache) have no clean per-user write to hang materialization on, so it can't even cover all the rule types without special-casing.

Option A also has the cleanest migration story: additive fields on an existing item, a dual-read fallback for zero-downtime rollout, and a one-off backfill that mirrors an established pattern. **The dedup key never moves** — the property most likely to cause silent data corruption if changed — which makes A the lowest-risk path.

When a user's shelf genuinely outgrows in-memory filtering, Option B's GSI can be added later **without** redoing the entry shape (tags already exist on the item; the GSI just indexes them). A → B is a forward door; B → A is not. That asymmetry settles it.

---

## Consequences

**Easier:**

- Tags, reading status, and Owned/Want all live on one item read in one call — web and MCP both get them inline (ADR-002 preserved).
- Auto-shelves are pure functions of the entry set — no membership to keep consistent, no fan-out writes.
- Duplicate detection is untouched; no risk to the `ENTRY#<isbn>` invariant.
- Unblocks the rest of the block: the "Open a book for full details" view now has tags + reading status + Owned/Want to render and edit.

**Harder:**

- "All books with tag X" / "by author Y" scan the user's entries in-memory — acceptable now, revisit with a GSI (Option B) if shelf sizes explode.
- Tag String Set needs care: normalize on write; `REMOVE` the attribute (not write an empty set) when the last tag goes; cap count + length server-side.
- One transition release carries both `status` (deprecated) and the new attributes until the web client and backfill catch up.

**To revisit:**

- ~~Owned + Want both true~~ — **resolved (2026-06-28): mutually exclusive, enforced** (Q1 revised). Not representable by design.
- Add the Option B GSI for tag/attribute reverse lookup **if** per-user entry counts reach the thousands.
- Per Q2, tags are free-text + suggestion-driven (autocomplete from the user's existing tags). A dedicated per-user tag registry/index is deferred — start by deriving the distinct-tag set from the entry scan; add the index if that proves costly.

---

## Open Questions (resolved 2026-06-27)

- **Q1 — Owned/Want exclusivity → RESOLVED: mutually exclusive (revised 2026-06-28).** A book is **owned XOR want — never both, never neither once added.** Originally this was "auto-clear, both-true allowed"; QA feedback confirmed both-true is undesirable, so exclusivity is now **enforced** at the API: `POST` rejects both-true and neither; `PATCH` auto-clears the _other_ flag symmetrically (set `owned:true` ⇒ `want:false`, set `want:true` ⇒ `owned:false`) and rejects an explicit both-true. Stored as two booleans (forward-compatible, migration already wrote them) with this invariant — effectively the original 2-state `status` re-expressed. Reading status and tags remain genuinely independent facets; only owned/want are exclusive.
- **Q2 — Tag vocabulary → RESOLVED: both free-text + suggestions.** Free-text tags **plus** a suggested/controlled set surfaced to **avoid duplication** (e.g. `sci-fi` vs `scifi` vs `Sci Fi`). Implementation: normalize on write (trim, lowercase, collapse whitespace) so near-duplicates collapse, and drive an autocomplete from the user's **existing tags** (distinct tags across their entries) so the input suggests prior choices before they free-type a new one. A per-user tag registry/index can be added later if computing the distinct set on the fly proves costly; start by deriving it from the entry scan.
- **Q3 — Auto-shelf surfacing → RESOLVED: three-tier model (2026-06-28).** System facets = filter bar; ad-hoc tag/author facets = on-demand type-ahead browse (never pre-listed); smart shelves = human-saved filter rules (`SMARTSHELF#<id>`) standing alongside curated shelves. See Decision §2. This avoids the large-library noise of auto-promoting every facet to a shelf. Remaining for `/design-handoff`: the visual layout/components/states (filter bar, browse panel, save-smart-shelf flow), not the model.
- **Q4 — `status` deprecation window → RESOLVED: one release.** One release of dual-emitting the deprecated `status` field is sufficient; the web client ships its attribute migration within that window, then the field + dual-read fallback are dropped (action item 8).

---

## Action Items

1. [x] Resolve Q1–Q4 (2026-06-27: Q1 auto-clear, Q2 free-text + suggestions, Q3 deferred to design-handoff, Q4 one release). Capture in `docs/specs/book-attributes-tags-auto-shelves.md` (`/product-management:write-spec`).
2. [ ] Entry shape: add `owned`/`want`/`readingStatus`/`tags` to `ShelfEntry`, `toShelfEntry` (with `status` dual-read fallback), and the put/update helpers in `lib/dynamo.ts`.
3. [ ] Tag write path: normalization + `TAGS_MAX_COUNT`/`TAG_MAX_LENGTH` caps; `PATCH /v1/shelf/:isbn/tags` (add/remove); empty-set `REMOVE` handling.
4. [ ] Generalize `queryBookEntries` filtering to `owned`/`want`/`readingStatus`/`tag`; keep cursor pagination for the unfiltered case.
5. [ ] Auto-shelf endpoint(s): system + tag/author rules computed server-side (shape decided by Q3).
6. [ ] Backfill `apps/api/scripts/migrate-status-to-attributes.ts` + `docs/runbooks/` migration runbook.
7. [ ] Additive API response (`owned`/`want`/`readingStatus`/`tags`, `status` deprecated); update ADR-002 note and web client.
8. [ ] Follow-up cleanup task: drop the `status` field + dual-read fallback after the transition release.
9. [ ] Record this decision in `docs/decisions.md` and flip Status → Accepted on sign-off.
