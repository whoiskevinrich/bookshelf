# ADR-002: Shelf API Response Shape — Paginated Inline Book Metadata

**Status:** Accepted  
**Date:** 2026-05-15  
**Deciders:** Solo developer  
**Context:** Core shelf spec (docs/specs/core-shelf.md), Open Question #3

---

## Context

`GET /v1/shelf` needs to return the authenticated user's shelf entries. The question is whether the response includes full book metadata inline, or only identifiers (ISBNs/ASINs) that callers must resolve in separate lookups.

The primary consumers are:
1. **Web UI** — renders the shelf with cover art, title, and authors
2. **MCP server** — needs enough context to reason about shelf contents in a single tool call (e.g., "what sci-fi books do I own?")

---

## Options Considered

### Option A: Identifiers only
```json
{
  "entries": [
    { "isbn": "9780441013593", "status": "owned", "addedAt": "2026-05-14T10:00:00Z" }
  ]
}
```
Callers issue a separate `GET /v1/books/{isbn}` per book to get metadata.

**Pros:** Smaller initial response; book metadata is cached/shared across users.  
**Cons:** N+1 request pattern for any list view; MCP tool calls require two round-trips to answer a simple question; increases latency and API call count.

### Option B: Full inline metadata (no pagination)
```json
{
  "entries": [
    {
      "isbn": "9780441013593",
      "status": "owned",
      "addedAt": "2026-05-14T10:00:00Z",
      "book": { "title": "Dune", "authors": ["Frank Herbert"], "coverUrl": "...", "publishedYear": 1965 }
    }
  ]
}
```
All metadata returned in one call, unbounded.

**Pros:** Single call for all rendering needs; MCP-friendly.  
**Cons:** Unbounded response size for large shelves; impractical at scale.

### Option C: Paginated inline metadata ✓
Same as Option B but with cursor-based pagination.

```json
{
  "entries": [ ... ],
  "nextCursor": "<opaque base64 string>",
  "total": 47
}
```

**Pros:** Single call per page; MCP tool calls work without follow-up lookups; maps cleanly to DynamoDB's `LastEvaluatedKey`; response size is bounded.  
**Cons:** Slightly more complex client and MCP implementation (must handle pagination).

---

## Decision: Option C — Paginated inline book metadata

**Rationale:** The MCP use case is the deciding factor. A tool like `get_shelf` should return enough information for an LLM to reason about shelf contents in a single invocation — without requiring a follow-up `get_book` call per entry. N+1 lookups make MCP interactions slow and expensive in token terms.

Cursor-based pagination is the natural fit for DynamoDB: `LastEvaluatedKey` becomes the cursor directly, avoiding offset scan costs. The default page size of 20 is sufficient for most shelf views and keeps response payloads small.

---

## API Contract

### `GET /v1/shelf`

**Query params:**
- `status` (optional): `owned` | `want` — filter by status
- `cursor` (optional): opaque pagination cursor from a previous response
- `limit` (optional): integer 1–100, default 20

**Response `200 OK`:**
```json
{
  "entries": [
    {
      "isbn":      "9780441013593",
      "status":    "owned",
      "addedAt":   "2026-05-14T10:00:00Z",
      "notes":     null,
      "book": {
        "title":         "Dune",
        "authors":       ["Frank Herbert"],
        "coverUrl":      "https://...",
        "publishedYear": 1965,
        "description":   "..."
      }
    }
  ],
  "nextCursor": "<base64-encoded LastEvaluatedKey or null>",
  "total":      47
}
```

**Notes:**
- `nextCursor` is `null` when the last page has been reached.
- `total` is a DynamoDB `Count` from a separate query — best-effort; may be slightly stale under concurrent writes.
- `coverUrl` may be `null`; clients must render a fallback.
- The cursor is opaque to clients — do not parse or construct it.

---

## DynamoDB Query Pattern

```typescript
const result = await dynamo.query({
  TableName: TABLE_NAME,
  KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
  ExpressionAttributeValues: {
    ':pk':     `USER#${userId}`,
    ':prefix': status ? `SHELF#${status}#` : 'SHELF#',
  },
  Limit: limit,
  ExclusiveStartKey: cursor ? decodeCursor(cursor) : undefined,
});
```

Book metadata fetched via `BatchGetItem` on `BOOK#<isbn>` keys from the entries in the page — one round-trip for metadata, not N.

---

## Consequences

**Easier:**
- Web UI renders a shelf page with a single API call
- MCP `get_shelf` tool returns actionable data without follow-up calls
- Pagination maps directly to DynamoDB's native continuation token

**Harder:**
- Clients must handle `nextCursor` and implement pagination if needed
- `BatchGetItem` for book metadata adds a second DynamoDB call per page (still O(1) calls per page, not O(n))
- `total` count requires a separate DynamoDB `Count` query; eventually consistent

**To revisit:**
- If `total` count proves expensive, remove it from the response and let clients detect end-of-list via `nextCursor === null`
- If shelves grow very large (100s of books), consider adding sort/filter query params
