# Runbook: Local Development

## New worktree setup

Git worktrees don't inherit `.env.local` files (they're gitignored). The SessionStart hook
copies them automatically, but you can also run it manually:

```bash
bash scripts/worktree-setup.sh
```

The script copies `apps/api/.env.local` and `apps/web/.env.local` from `G:\source\bookshelf`.
If your main worktree is elsewhere:

```bash
bash scripts/worktree-setup.sh -MainWorktree "C:\path\to\bookshelf"
```

**If the main worktree has no `.env.local` files yet**, create them from `.env.example` and
populate from SSM:

```bash
aws ssm get-parameter --name /bookshelf/cognito/user-pool-id --query Parameter.Value --output text
aws ssm get-parameter --name /bookshelf/cognito/client-id    --query Parameter.Value --output text
aws ssm get-parameter --name /bookshelf/api/url              --query Parameter.Value --output text
```

---

## Starting the dev stack

Auth and data both run against real AWS (dev environment). No Docker required.

```bash
pnpm --filter @bookshelf/api dev      # API on :3001 → real DynamoDB
pnpm --filter @bookshelf/web dev      # Web on :3000 → real Cognito
```

First time on a new machine or fresh table, seed your shelf:

```bash
pnpm --filter @bookshelf/api db:seed
```

This writes 10 Sci-Fi/Fantasy demo books under `LOCAL_DEV_USER_ID` (set in `apps/api/.env.local`).
Safe to re-run — existing items are overwritten, not duplicated.

---

## Troubleshooting

**"Auth UserPool not configured" on startup**
`VITE_COGNITO_USER_POOL_ID` is missing — run `worktree-setup.sh` to copy `apps/web/.env.local`.

**API returns 401**
Your Cognito session has expired — sign out and sign back in at `/auth/login`.

**API returns 5xx / DynamoDB error**
AWS credentials may be expired or the dev table doesn't exist yet. Check:

```bash
aws sts get-caller-identity            # confirm credentials are valid
aws dynamodb describe-table --table-name bookshelf  # confirm table exists
```

If the table is missing, it was likely never deployed: `cdk deploy BookshelfApi` in
`packages/infra`.
