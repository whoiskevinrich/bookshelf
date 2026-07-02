# Spec: Multiple Copies of the Same Book

**Status**: Draft
**Date**: 2026-07-02
**Owner**: Solo developer
**Jira**: BOOKSHELF-60 (epic BOOKSHELF-62 Feedback)
**Related**: ADR-019 (entry attributes), ADR-002 (shelf API / MCP inline), `docs/specs/core-shelf.md`

## Problem

A user's relationship to a book is one DynamoDB item keyed `USER#<userId>` / `ENTRY#<isbn>` — **exactly one entry per ISBN per user**. A user who owns two physical copies of the same book (one to lend, one to keep; a spare gifted copy) can't represent it. Adding the same ISBN again returns **409 Conflict** (duplicate detection), so the second copy is simply refused.

User feedback (2026-07-01, rank 14): _"Options for adding different editions or multiple copies."_

## Scope

**In scope — multiple copies of one ISBN, as a count.** Track _how many_ copies of a given book the user owns.

**Out of scope (deferred) — edition grouping.** Showing hardcover + paperback + audiobook of one _work_ together is a separate concern: different editions already have different ISBNs and can be added today (they just appear as unrelated books). Work-level grouping needs a `WORK#`-style entity and metadata we don't store, and is tracked separately (see Out of Scope). This spec deliberately does **not** change the key schema, so it does not foreclose that future work.

## Goals / Non-goals

**Goals**

- Represent owning N copies of the same ISBN without a second entry.
- Turn a duplicate add into a helpful "add another copy" action instead of a dead-end 409.
- Keep the change additive and reversible — no key-schema change, no migration.

**Non-goals**

- Per-copy attributes (condition, location, acquired date, per-copy notes). Explicitly rejected for v1 (decision below) — that would require a per-copy sort key.
- Edition/format grouping across ISBNs.
- Copies of _wishlist_ books (a count only makes sense for owned; see Data model).

## Decision — a `copies` count, key unchanged

Add one integer attribute to the existing entry item:

```jsonc
PK = USER#<userId>   SK = ENTRY#<isbn>
{
  "isbn": "9780553381351",
  "owned": true,
  "want": false,
  "copies": 2,          // NEW — integer ≥ 1, defaults to 1, only meaningful when owned
  "readingStatus": "reading",
  "tags": ["sci-fi"],
  "addedAt": "...",
  "notes": null
}
```

- **`ENTRY#<isbn>` stays the duplicate-detection key** — the single most important invariant (ADR-019). No `ENTRY#<isbn>#<copyId>`, no migration, no change to the shared `BOOK#<isbn>` metadata cache.
- `copies` is a bounded integer: **`COPIES_MAX = 99`**, minimum `1` (a named constant near the write site, per the endpoint checklist). Absent/legacy items read as `1` (dual-read default, like ADR-019's `status` fallback — no backfill required).
- `copies` is only meaningful for **owned** books. On `want` (wishlist) it is forced to `1` / ignored. Moving owned→want resets it to 1.

### Why "just a count" (not per-copy records)

Per-copy attributes were considered and rejected for v1. They'd require an `ENTRY#<isbn>#<copyId>` sort key, which changes duplicate detection, the 409 contract, MCP inline shape, and needs a migration — a large ADR for a need no feedback has expressed. A count covers the stated use ("I own more than one") at near-zero cost and stays a forward door: if per-copy detail is ever needed, the count is trivially derived from per-copy records later.

## Duplicate-add behavior (the 409 change)

Today: `POST /v1/shelf` with an already-owned ISBN → **409**. New behavior:

- The API keeps returning **409** on a duplicate `POST` (the contract is unchanged — important for MCP and existing clients).
- **The web client turns that 409 into an offer**: "You already own this — add another copy?" → calls a new increment path (below). The duplicate is no longer a dead-end; the count is how you "add again".
- Adding a copy is an explicit, visible action — never silent (mirrors the scanner "never add to a surprising place" principle).

## API

Prefer reusing the existing attribute-update path over a bespoke route.

- **Read**: `GET /v1/shelf` entries gain `copies` (additive; defaults to `1`). MCP `get_shelf` gets it inline for free (ADR-002 preserved).
- **Write**: extend the existing `PATCH /v1/shelf/:isbn` to accept `copies` (validated `1..COPIES_MAX`, integer; reject otherwise with **400**). Increment/decrement is computed client-side and sent as the absolute new value (idempotent, avoids a race-y server-side `ADD`).
- No new route required; if a dedicated `PATCH /v1/shelf/:isbn/copies` reads better at implementation time, it must still clear the endpoint checklist (auth at router level, integer + bound validation, generic 500s).

## UX

- **Book card / detail**: when `copies > 1`, show a small count badge (e.g. "×2"). Use a shape/number, not color alone (color-blind guideline).
- **Detail page**: a stepper (− / count / +) on owned books, bounded `1..99`, disabled-state avoided per CDS (respond on use). Setting count to 0 is **not** a delete shortcut — removal stays the explicit destructive action (pairs with the Manage-Library bulk mode, BOOKSHELF-59).
- **Duplicate add**: the 409 offer described above, in both search-add and scan flows.
- Zero visual change for the common `copies === 1` case.

## Acceptance criteria

- [ ] Owning N copies is representable without a second entry; `ENTRY#<isbn>` key unchanged.
- [ ] `copies` validated `1..99` integer server-side; 400 on violation; legacy/absent reads as 1.
- [ ] Duplicate `POST` still 409s; web surfaces an "add another copy" affordance that increments.
- [ ] `copies` travels inline on `GET /v1/shelf` and MCP `get_shelf`.
- [ ] Count only applies to owned; owned→want resets to 1.
- [ ] Card badge + detail stepper; count-by-color avoided; RTL coverage.

## Out of scope / follow-ups

- **Edition grouping** (hardcover/paperback/audio of one work) — needs a work-level entity + edition metadata; file as a separate story under BOOKSHELF-62 or a new epic. This spec's count model does not block it.
- **Per-copy condition/location/lending status** — revisit only if users ask; would graduate the count into `ENTRY#<isbn>#<copyId>` records and warrants its own ADR at that point.

## Open questions

- Q1 — Does a duplicate **scan** in continuous mode auto-increment, or always prompt? Lean prompt (never silent), but continuous-scan ergonomics may argue for a subtle auto-increment with undo. Resolve in frontend-design.
- Q2 — Do wishlist→owned transitions ever carry a count? No for v1 (count resets to 1 on owned), revisit if edition grouping lands.
