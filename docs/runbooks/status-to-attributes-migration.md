# Runbook: Backfill `status` → `owned`/`want` Attributes

Per [ADR-019](../adrs/019-book-attributes-tags-auto-shelves.md), shelf entries moved
from a mutually-exclusive `status` enum to independent `owned` / `want` /
`readingStatus` attributes. The API reads both shapes (dual-read in `toShelfEntry`),
so it is correct **before** this backfill runs — but the backfill writes the new
attributes onto existing items so filtering and future cleanup don't depend on the
fallback forever.

Script: `apps/api/scripts/migrate-status-to-attributes.ts`
(run via `pnpm --filter @bookshelf/api migrate:attributes`).

## What it rewrites

Every shelf-entry item that still lacks an `owned` attribute:

| Item type   | Key                          | Change                                                         |
| ----------- | ---------------------------- | -------------------------------------------------------------- |
| Shelf entry | `USER#<id>` / `ENTRY#<isbn>` | Adds `owned`, `want` (from `status`) and `readingStatus: null` |

The legacy `status` attribute is **left in place** — the API still emits a derived
`status` for one transition release (ADR-019 Q4), and the dual-read prefers
`owned`/`want` once present. `status` is removed later in the cleanup task
(ADR-019 action item 8), not here.

## Safety properties

- **Idempotent.** A `ConditionExpression: attribute_not_exists(owned)` skips any item
  already migrated; re-running is a no-op (counted as `alreadyDone`).
- **Dry-run first.** `--dry-run` lists every planned rewrite and writes nothing.
- **Non-destructive.** It only **adds** attributes; nothing is deleted or overwritten.
- **Malformed items are flagged, not changed.** An `ENTRY#` item with neither `owned`
  nor a valid `status` is logged (`malformed`) and left untouched for manual review.

## Prerequisites

- Active AWS credentials for the **target account** in the current shell. The script
  hits the `bookshelf` table in whichever account your credentials resolve to — so
  **the credentials select the environment**. There is no `--env` flag.
  - dev → `dev/AWSPowerUserAccess` (account `058308164167`)
  - prod → `prod/AWSPowerUserAccess` (account `071526660165`)
- Table name defaults to `bookshelf`. Override with `DYNAMODB_TABLE_NAME` only when
  testing against a non-default table.

> Granted `assume` exports creds to your **interactive** shell only. Run these commands
> in that same shell, or export `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` /
> `AWS_SESSION_TOKEN` explicitly.

## Steps

### 1. Dry-run against dev

```powershell
assume dev/AWSPowerUserAccess        # populates AWS creds in this shell
pnpm --filter @bookshelf/api migrate:attributes -- --dry-run
```

Review the `[dry-run] … → owned=… want=…` lines and the final
`migrated=… alreadyDone=… malformed=… skipped=… errors=…` summary.

### 2. Execute against dev

```powershell
pnpm --filter @bookshelf/api migrate:attributes
```

### 3. Verify

In the app, confirm the shelf renders, the Owned/Want sections are correct, and the
`GET /v1/shelf?owned=true` / `?want=true` filters return the expected books. A spot
check in the console: every `ENTRY#` item should now have an `owned` boolean and no
remaining item should have a `status` value without `owned`.

### 4. Promote to prod

Repeat steps 1–3 with prod credentials:

```powershell
assume prod/AWSPowerUserAccess
pnpm --filter @bookshelf/api migrate:attributes -- --dry-run
pnpm --filter @bookshelf/api migrate:attributes
```

## Ordering vs. deploy

Safe to run **before or after** the API deploy — it's idempotent and the dual-read
makes the API correct regardless. Running it shortly **after** the API is live means
all new writes already use the attribute shape while the backfill catches up the rest.

## Rollback

The migration only adds attributes, so there is nothing to undo functionally. If a
restore is ever needed for unrelated reasons, rely on **DynamoDB Point-in-Time
Recovery** — see `docs/runbooks/rollback.md`.
