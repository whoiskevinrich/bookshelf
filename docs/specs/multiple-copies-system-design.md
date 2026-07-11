# System Design: Multiple Copies of the Same Book (BOOKSHELF-60)

**Status**: Design complete, implementation not started
**Date**: 2026-07-10
**Owner**: Solo developer
**Jira**: [BOOKSHELF-60](https://whoiskevinrich.atlassian.net/browse/BOOKSHELF-60) (epic BOOKSHELF-62 Feedback)
**Related**: `docs/specs/multiple-copies.md` (product spec / decision — this doc is its system-design companion), `docs/specs/multiple-copies-design-handoff.md` (frontend component-level spec — card badge, detail stepper, duplicate-add prompt), ADR-002 (shelf API shape), ADR-019 (entry attributes, same additive pattern)

This is the system-design deep dive for the decision already recorded in `docs/specs/multiple-copies.md` and `docs/decisions.md`. That spec settled _what_ to build (a `copies` count, key unchanged); this doc grounds _how it fits the running system_ — current code paths, request flow, failure modes, and what would have to change if the requirements grow.

## 1. Requirements

**Functional**

- A user can record owning more than one copy of the same ISBN.
- Adding an already-owned ISBN again offers "add another copy" instead of a dead-end error.
- The count is visible on the shelf and editable from the book detail page.

**Non-functional**

- No migration, no downtime, no backfill — the change must be safely deployable and rollback-able in the middle of normal operation.
- No new infrastructure (tables, indexes, queues) — this is a single-developer, free-tier system (ADR-001); every standing resource has a cost and an operational surface.
- MCP parity (ADR-002): whatever the web client sees, the MCP `get_shelf`/`list_shelf` tool sees in the same call, with no server-side changes on the MCP side.

**Constraints**

- Per-user data volume is small — tens to low-hundreds of books (ADR-019's stated scale assumption still holds; nothing here changes it).
- `ENTRY#<isbn>` is the existing duplicate-detection key and must not move (see §3).

## 2. High-Level Design

No new components. This is an attribute added to an existing item, read and written through the existing request path:

```
┌─────────────┐        ┌──────────────────┐        ┌──────────────────────┐
│  Web SPA     │──────▶│  API (Hono/Lambda) │──────▶│  DynamoDB "bookshelf"  │
│  (React)     │◀──────│  apps/api/src      │◀──────│  single table          │
└─────────────┘        └──────────────────┘        └──────────────────────┘
       ▲                        ▲
       │ same GET /v1/shelf     │ same JSON, no schema on MCP side
       │ response, +copies      │
┌─────────────┐                 │
│  MCP server  │────────────────┘
│  apps/mcp    │  (thin proxy — apps/mcp/src/tools/shelf.ts forwards the API
└─────────────┘   response verbatim via okResult(), no field allowlist)
```

**Data flow — reading a shelf:**
`GET /v1/shelf` → `queryBookEntries` (`apps/api/src/lib/dynamo.ts:282-346`) → `toShelfEntry` mapper (`dynamo.ts:160-180`) → JSON response, `book` metadata batch-fetched separately (ADR-002). `copies` rides inline on the same entry item read — no extra round trip.

**Data flow — duplicate add → increment:**

```
User scans/searches an owned ISBN
        │
        ▼
POST /v1/shelf ─────▶ putBookEntry (ConditionExpression: attribute_not_exists(PK))
        │                                   │
        │                          ConditionalCheckFailedException
        ▼                                   │
   web client catches 409 ◀─────────────────┘
        │
        ▼
  "You already own this — add another copy?"
        │
        ▼
PATCH /v1/shelf/:isbn { copies: currentCopies + 1 } ─────▶ updateBookEntryAttributes
                                                              (dynamo.ts:387-424,
                                                               ConditionExpression:
                                                               attribute_exists(PK))
```

The 409 contract is unchanged (existing MCP/API clients see the same behavior); the increment is a second, explicit call the web client makes after the user opts in — never automatic.

## 3. Data Model

Current entry item (`ShelfEntry` interface, `apps/api/src/lib/dynamo.ts:79-92`):

```
PK = USER#<userId>   SK = ENTRY#<isbn>
{ isbn, owned, want, readingStatus, tags: string[], addedAt, notes, copies }
                                                              ^^^^^^ new
```

`copies` slots in next to `readingStatus` in three places, following the exact pattern ADR-019 established for that field:

1. `ShelfEntry` / `EntryAttributePatch` interfaces — add `copies?: number`.
2. `toShelfEntry` mapper — dual-read default: `copies: num(item["copies"]) ?? 1` (same coercion helper already used at `dynamo.ts:143-144`), so every legacy item with no `copies` attribute reads as `1` with no backfill script.
3. `updateBookEntryAttributes`'s dynamic `SET` builder — one more optional field, same `ConditionExpression: attribute_exists(PK)` guard against updating a non-existent entry (→ 404 in the route).

**Why the key doesn't move:** `ENTRY#<isbn>` is the sole duplicate-detection mechanism — `putBookEntry`'s `ConditionExpression: attribute_not_exists(PK)` (`dynamo.ts:358-380`) _is_ the 409. A per-copy model (`ENTRY#<isbn>#<copyId>`) would require: a new sort-key range query to detect "does this user already have any copy of this ISBN" (replacing an O(1) conditional put with a query-then-write), a migration of every existing entry into copy-id `#1`, and a breaking change to the MCP inline shape (an array of copies instead of one entry). None of that is justified by the feedback ("options for adding... multiple copies" — a count answers it), so it's deferred (see §8).

**Infra:** `packages/infra/lib/api-stack.ts:90-97` defines the table as `PK`/`SK` only, on-demand billing, no GSI. DynamoDB is schemaless beyond the key — adding `copies` as a plain attribute is a **zero-diff CDK change**. No `cdk deploy` for infra, no `pnpm -r build` asset dependency beyond the normal Lambda code deploy.

## 4. API Contract

**`GET /v1/shelf`** — additive field, no version bump:

```jsonc
{
  "entries": [{ "isbn": "...", "owned": true, "copies": 2 /* ...unchanged fields */ }],
  "nextCursor": "...",
  "total": 47,
}
```

**`PATCH /v1/shelf/:isbn`** (`apps/api/src/routes/shelf.ts:379-471`) — extend the existing handler, same shape as the `/notes` and `/tags` siblings (parse → validate → 404 lookup → mutate → return merged entry):

```
COPIES_MAX = 99   // named constant near the write site, per endpoint checklist

if (body.copies !== undefined) {
  if (!Number.isInteger(body.copies) || body.copies < 1 || body.copies > COPIES_MAX) {
    return c.json({ error: "copies must be an integer between 1 and 99" }, 400);
  }
}
```

- **404** if the entry doesn't exist (existing `getBookEntry` lookup at lines 438-447 — unchanged).
- **400** on out-of-range/non-integer `copies` (new — mirrors the `limit` range check at lines 126-128 and the tags-array checks at 334-355).
- Owned/want mutual-exclusion validation (429-436) is untouched; `copies` is orthogonal to that check. When `owned` flips to `false` (want), the route should reset `copies` to `1` server-side — one extra assignment in the same `SET` builder, not a second call.
- No new route. A dedicated `PATCH /v1/shelf/:isbn/copies` was considered (§8) but the generic attribute-patch endpoint already exists and already validates one field at a time; reusing it is less surface area for a single integer.

**`POST /v1/shelf`** (lines 176-278) — unchanged. The 409 path (`ConditionalCheckFailedException` catch at 242-248) keeps its current message; the "add another copy" affordance is purely a web-client-side response to that existing error, not a new server behavior.

**MCP** (`apps/mcp/src/tools/shelf.ts:5-33`, `apps/mcp/src/lib/api.ts:1-34`) — `list_shelf` forwards the raw API JSON via `okResult()` with no field allowlist. `copies` appears automatically; zero MCP code changes.

## 5. Deep Dive: Concurrency & Idempotency

The spec chose **absolute-value writes** (client sends the new total, e.g. `{ copies: 3 }`) over a server-side atomic increment (`ADD copies :one`). Trade-off made explicit:

- **Atomic `ADD`** is race-free across concurrent writers (e.g. two browser tabs both incrementing) but makes "set to exactly N" (needed for the stepper's direct-entry and the decrement button) awkward — you'd need both an `ADD` and a `SET` code path.
- **Absolute value** is simpler (one code path, matches the pattern of every other attribute patch in this file) but is last-write-wins under a race: two concurrent PATCHes from the same user (e.g. a phone and a laptop tab open at once) could clobber each other.

This is accepted because the entity is single-user, single-owner data with no realistic concurrent-writer scenario in practice (one person editing their own shelf), unlike a shared counter (e.g. inventory stock) where atomicity would be load-bearing. If multi-device simultaneous editing ever becomes a real complaint, the fix is additive: keep absolute-value `PATCH` for the UI, add an optional `ConditionExpression` on the entry's `updatedAt` (optimistic concurrency) without changing the wire shape.

## 6. Scale & Reliability

- **Load:** one additional integer attribute on an item already read/written on every shelf interaction. No new DynamoDB read/write units beyond what the existing `PATCH` already costs (same item, same request).
- **Failure modes:** identical to every other attribute patch today — `ConditionalCheckFailedException` → 404 (entry gone), validation failure → 400, unexpected error → generic 500 with server-side `console.error` (per the endpoint checklist). No new failure mode is introduced.
- **Rollback:** because the field is additive and defaults to `1` when absent, rollback is "stop reading/writing the field" — no data to unwind, no forward-compat break for a deployed-then-reverted API version.
- **Availability:** unchanged. On-demand DynamoDB billing (ADR-001) means no capacity planning for the (negligible) extra attribute bytes.

## 7. Monitoring

No new metric is required to operate this safely — it rides the existing `PATCH /v1/shelf/:isbn` request path, already covered by whatever Lambda/API Gateway error-rate visibility exists today. Optionally, if this feedback item (BOOKSHELF-60 came from user-feedback synthesis, ranked 14/14 — low signal) turns out to matter more than expected, a lightweight `track()` analytics event (ADR-016 pattern: add to the client `AnalyticsEvent` union + server `ALLOWED_EVENTS` allowlist) on "copies incremented" would answer "does anyone use this" without any backend storage change. Not required for v1; noted as a cheap follow-up if usage data is ever wanted.

## 8. Trade-off Analysis

| Option                                                                       | Description                                    | Pros                                                                  | Cons                                                                                                                                                                                                          | Verdict                                                                                                                                    |
| ---------------------------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **A — `copies` int on existing entry (chosen)**                              | One bounded attribute, key unchanged           | Zero migration, zero infra diff, MCP-free, reversible in one deploy   | Can't attach per-copy detail (condition, location, lending) later without a bigger change                                                                                                                     | **Chosen** — matches the actual feedback ("options for... multiple copies"), nothing asked for per-copy metadata                           |
| **B — Per-copy child items (`ENTRY#<isbn>#<copyId>`)**                       | Sort-key range per copy                        | Extensible to per-copy condition/location/lending status              | Breaks the O(1) duplicate-detection conditional-put (needs a query first), migrates every existing entry, changes MCP inline shape (array vs. scalar), needs its own ADR (per the spec's key-schema-ADR gate) | Rejected for v1 — no expressed need justifies the migration risk. Revisit only if users ask for per-copy attributes (spec §"Out of scope") |
| **C — Separate `copies` GSI/table**                                          | Model copies as first-class queryable entities | Enables cross-user "how many total copies of this book exist" queries | No such query exists or is requested; adds a standing-cost index for a need that doesn't exist (violates ADR-019's "no new GSI until a query pattern hurts")                                                  | Rejected — speculative                                                                                                                     |
| **Dedicated `PATCH /:isbn/copies` route vs. reusing generic `PATCH /:isbn`** | New route vs. extending existing handler       | Dedicated route reads slightly more explicitly                        | Reusing the existing handler matches the `/notes`/`/tags` sibling pattern already in the file, avoids router/auth-middleware duplication                                                                      | **Reuse chosen**; spec leaves the door open to split it out later if it reads better at implementation time                                |

## 9. What to Revisit as It Grows

- **Per-copy attributes** (condition, location, lending status) → graduates the count into `ENTRY#<isbn>#<copyId>` child items. This is the one change here that _would_ need its own ADR (key-schema move), per the spec's stated gate. Trigger: users explicitly ask for it (none have yet).
- **Edition grouping** (hardcover/paperback/audio of one work) → a distinct `WORK#`-style entity with its own metadata; explicitly out of scope here and tracked as a separate story under the BOOKSHELF-62 epic.
- **A copies-based filter/sort** (e.g. "show only books with 2+ copies") → today all shelf filtering is in-memory over one user's partition (`queryBookEntries`, no GSI, ADR-019). At current per-user scale that stays free; only worth a GSI if per-user library sizes grow enough that in-memory filtering becomes the bottleneck — same threshold ADR-019 already names for tags/auto-shelves.
- **Concurrent-write correctness** (§5) → add optimistic concurrency (`ConditionExpression` on `updatedAt`) only if multi-device races are ever reported; no need to build it speculatively.
