# Runbook: Local Development

## New worktree setup

Git worktrees don't inherit `.env.local` files (they're gitignored). Run this once after creating a worktree:

```powershell
.\scripts\worktree-setup.ps1
```

The script copies `apps/api/.env.local` and `apps/web/.env.local` from `G:\source\bookshelf` (the main worktree). If your main worktree is elsewhere:

```powershell
.\scripts\worktree-setup.ps1 -MainWorktree "C:\path\to\bookshelf"
```

The script is idempotent — it skips files that already exist and reports what it copied.

**If the main worktree has no `.env.local` files yet**, see [cicd-setup.md](./cicd-setup.md) and [local-dynamodb.md](./local-dynamodb.md) to create them from `.env.example`.

---

## Dev modes

Choose based on what you're working on.

### Mode A — Frontend only (MSW mock API)

No Docker or API server needed. Auth is real Cognito; all `/v1/*` calls are intercepted by [MSW](https://mswjs.io/) with realistic in-memory seed data.

**Requires:** `apps/web/.env.local` with Cognito vars (copied by `worktree-setup.ps1`).

```sh
pnpm --filter @bookshelf/web dev:mock
```

Sign in with your real Cognito account. The shelf loads from mock seed data — no DynamoDB read. Mutations (add, move, remove) work against in-memory state for the browser session.

| File | Purpose |
|---|---|
| `apps/web/src/mocks/seed-data.ts` | Initial mock shelf (4 books) |
| `apps/web/src/mocks/handlers.ts` | MSW request handlers for all `/v1/*` routes |
| `apps/web/.env.mock` | Vite mode file — sets `VITE_MOCK_API=true`, clears `VITE_API_BASE_URL` |

`vite build --mode mock` is blocked at the config level — mock mode cannot produce a production bundle.

### Mode B — Full stack (real API + DynamoDB Local)

```sh
docker compose up -d                    # DynamoDB Local on port 8000
pnpm --filter @bookshelf/api db:seed    # first time only — creates table + seeds 10 books
pnpm --filter @bookshelf/api dev        # API on :3001
pnpm --filter @bookshelf/web dev        # Frontend on :3000
```

**Requires:** both `apps/api/.env.local` and `apps/web/.env.local`.

See [local-dynamodb.md](./local-dynamodb.md) for DynamoDB operations (reset, inspect, switch to real AWS).

---

## Which mode to use?

| Scenario | Mode |
|---|---|
| New worktree, no Docker running | A — after running `worktree-setup.ps1` |
| Building / iterating on UI | A |
| Testing real API behavior or DynamoDB queries | B |
| Testing auth sign-up / sign-in flows | B |
| Pre-merge review / CI | B |

---

## Troubleshooting

**"Auth UserPool not configured" on startup**
`VITE_COGNITO_USER_POOL_ID` is missing. Run `worktree-setup.ps1` to copy `apps/web/.env.local`.

**API returns 401 in mock mode**
MSW intercepts `/v1/*` only. A path not covered by `handlers.ts` falls through to the (absent) API server and fails. Add a handler in `apps/web/src/mocks/handlers.ts` or switch to Mode B.

**DynamoDB connection refused**
Docker isn't running, or the container hasn't started. Run `docker compose up -d` and wait for the health check to pass (`docker compose ps`).
