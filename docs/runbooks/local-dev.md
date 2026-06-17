# Runbook: Local Development

## Prerequisites — AWS credentials

The API connects directly to AWS DynamoDB and Cognito in the dev environment.
**You must have active AWS credentials before starting the API dev server.**

This project uses [Granted](https://docs.commonfate.io/granted/introduction) for credential management:

```bash
assume dev/AWSPowerUserAccess
```

Credentials expire (typically after 1 hour). Re-run `assume` if the API starts returning
DynamoDB errors. Verify credentials are active at any time with:

```bash
aws sts get-caller-identity
```

---

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

**If the main worktree has no `.env.local` files yet**, first assume credentials, then
populate from SSM:

```bash
assume dev/AWSPowerUserAccess
aws ssm get-parameter --name /bookshelf/cognito/user-pool-id --query Parameter.Value --output text
aws ssm get-parameter --name /bookshelf/cognito/client-id    --query Parameter.Value --output text
aws ssm get-parameter --name /bookshelf/api/url              --query Parameter.Value --output text
```

---

## Starting the dev stack

Use the `/dev` skill from Claude Code — it handles credential acquisition automatically:

```
/dev
```

The skill checks for active AWS credentials, runs
`assume dev/AWSPowerUserAccess --exec "pnpm --filter @bookshelf/api dev"`
if credentials are missing or expired, then starts the web server alongside it.

**To start manually** (outside Claude Code):

```bash
assume dev/AWSPowerUserAccess
pnpm --filter @bookshelf/api dev          # API on :3001 → real DynamoDB
pnpm --filter @bookshelf/web dev          # Web on :3000 → real Cognito
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

**API returns 5xx / DynamoDB CredentialsProviderError**
AWS credentials are missing or expired — run `assume dev/AWSPowerUserAccess` then restart the API.

**Shelf loads then shows error state in browser**
Same as above — the API started but credentials expired mid-session. Re-run `assume` and
restart `pnpm --filter @bookshelf/api dev`.

**Table not found**
The dev DynamoDB table doesn't exist yet. Deploy it first:

```bash
pnpm --filter @bookshelf/infra run cdk deploy BookshelfApi
```

Then seed: `pnpm --filter @bookshelf/api db:seed`.
