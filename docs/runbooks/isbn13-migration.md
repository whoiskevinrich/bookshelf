# Runbook: Backfill ISBN-10 → ISBN-13 Keys

After the API write boundary began canonicalizing every ISBN to ISBN-13
(`normalizeIsbn` in `apps/api/src/lib/isbn.ts`), existing DynamoDB items that were
written under an **ISBN-10 key** must be re-keyed so the old and new entry paths
dedup against one another. This runbook covers the one-off backfill.

Script: `apps/api/scripts/migrate-isbn10-to-13.ts` (run via `pnpm --filter @bookshelf/api migrate:isbn13`).

## What it rewrites

Any item whose key encodes a valid ISBN-10, across all three keyed item types:

| Item type      | Key                                      | Change                     |
| -------------- | ---------------------------------------- | -------------------------- |
| Shelf entry    | `USER#<id>` / `ENTRY#<isbn>`             | SK + `isbn` attr → ISBN-13 |
| Shelf member   | `USER#<id>` / `SMEMBER#<shelfId>#<isbn>` | SK + `isbn` attr → ISBN-13 |
| Metadata cache | `BOOK#<isbn>` / `METADATA`               | PK + `isbn` attr → ISBN-13 |

## Safety properties

- **Idempotent.** Re-running finds no ISBN-10 keys left and is a no-op.
- **Dry-run first.** `--dry-run` lists every planned rewrite and writes nothing.
- **Collision-safe.** If the ISBN-13 target already exists (a book added via both an
  ISBN-10 and an ISBN-13 path), the existing ISBN-13 item is **kept** and the stale
  ISBN-10 item is deleted. Collisions are counted and logged for review.

## Prerequisites

- Active AWS credentials for the **target account** in the current shell. The script
  hits the `bookshelf` table in whichever account your credentials resolve to — so
  **the credentials select the environment**. There is no `--env` flag.
  - dev → `dev/AWSPowerUserAccess` (account `058308164167`)
  - prod → `prod/AWSPowerUserAccess` (account `071526660165`)
- The table name defaults to `bookshelf` (same name in both accounts). Override with
  `DYNAMODB_TABLE_NAME` only if testing against a non-default table.

> Granted `assume` exports creds to your **interactive** shell only. Run these commands
> in that same shell (not via a fresh tool call), or export `AWS_ACCESS_KEY_ID` /
> `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN` explicitly.

## Steps

### 1. Dry-run against dev

```powershell
assume dev/AWSPowerUserAccess        # populates AWS creds in this shell
pnpm --filter @bookshelf/api migrate:isbn13 -- --dry-run
```

Review the `[dry-run] … → …` lines and the final
`migrated=… collisions=… skipped=… errors=…` summary. Confirm the rewrites and
collision count look right.

### 2. Execute against dev

```powershell
pnpm --filter @bookshelf/api migrate:isbn13
```

Verify in the app (search-add vs. scan-add of the same book now dedup; the shelf
renders correctly) before touching prod.

### 3. Promote to prod

Repeat steps 1–2 with prod credentials:

```powershell
assume prod/AWSPowerUserAccess
pnpm --filter @bookshelf/api migrate:isbn13 -- --dry-run
pnpm --filter @bookshelf/api migrate:isbn13
```

## Ordering vs. deploy

The migration is safe to run **before or after** the API deploy — it's idempotent and
the new code only ever writes ISBN-13 keys. Running it shortly **after** the API is
live means no new ISBN-10 keys can appear while it runs.

## Rollback

There is no automated rollback (the source ISBN-10 items are deleted after the ISBN-13
item is written). Rely on **DynamoDB Point-in-Time Recovery** if a restore is ever
needed — see `docs/runbooks/rollback.md`.
