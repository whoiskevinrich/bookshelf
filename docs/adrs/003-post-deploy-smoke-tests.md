# ADR-003: Post-Deploy Smoke Tests with Automatic Rollback

**Date:** 2026-05-31
**Status:** Accepted

---

## Context

After CDK deploys to the dev environment, the previously-manual smoke test task
("Deploy to dev; smoke-test all endpoints with curl") had no automated
equivalent. A bad deploy could be tagged and promoted to production before
anyone noticed the API was broken.

Two requirements drove this decision:

1. Every deploy to dev must be automatically verified against the live API.
2. If verification fails, the environment must be automatically restored to the
   last known-good state without manual intervention.

---

## Decision

Add a Vitest smoke suite (`apps/api/test/smoke/`) that runs against the live API
URL immediately after every `cdk deploy --all` in the dev deploy workflow. If
the smoke tests fail, the workflow automatically redeploys the previously-tagged
version before marking the job as failed.

---

## Implementation

### Smoke test suite (`apps/api/test/smoke/smoke.test.ts`)

Runs via `pnpm --filter @bookshelf/api run test:smoke` with `API_BASE_URL` set
to the live API Gateway endpoint. Covers:

| Suite                   | Assertions                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------- |
| Health                  | `GET /health` → 200 `{ status: "ok" }`                                                                  |
| Books (unauthenticated) | Search returns results; missing `q` → 400; ISBN lookup → 200/404 with correct shape; invalid ISBN → 400 |
| Shelf (auth gate)       | GET/POST/PATCH/DELETE all return 401 without a token; malformed token → 401                             |
| 404 handling            | Unknown route → 404                                                                                     |

The suite is excluded from the regular `vitest run` (unit test job) via
`vitest.config.ts` — it only runs when `API_BASE_URL` is set, which the deploy
workflow provides from SSM.

### Deploy workflow additions (`.github/workflows/deploy.yml`)

Four steps are inserted between `CDK deploy all stacks` and `Tag deployed
version`:

```
Capture last good version tag   →  records current HEAD tag before deploying
CDK deploy all stacks           →  (existing step)
Resolve API URL from SSM        →  reads /bookshelf/api/url into step output
Smoke tests                     →  continue-on-error: true
Rollback to last good version   →  if: smoke failed  →  git checkout <tag>, rebuild, cdk deploy
Fail job after rollback         →  if: smoke failed  →  exit 1
Tag deployed version            →  only reached when smoke passed
```

**Rollback mechanism:** before deploying, the last semver git tag is captured.
Because tags are only pushed after a clean smoke run, this is always the
previously-verified deployed version. On smoke failure the workflow checks out
that tag, rebuilds the API bundle from it, and runs `cdk deploy --all` to
restore the Lambda. The job then fails with a clear message so the bad commit
is visible in CI. The broken version never receives a tag.

---

## Consequences

**Good:**

- The "Deploy to dev; smoke-test all endpoints" task is fully automated and
  gates every merge to main.
- A broken deploy self-heals without manual intervention; dev is always left in
  a runnable state.
- The version tag guarantee is strengthened: a tag now means "deployed and
  smoke-tested", not just "deployed".

**Trade-offs:**

- A failed deploy takes longer to complete (rollback CDK deploy adds ~2–3 min).
- The smoke suite covers auth-gate shape and basic connectivity only — it does
  not perform full CRUD with real Cognito tokens. Authenticated-path regressions
  require manual verification or a future authenticated smoke stage.
- If the last-good tag is empty (first-ever deploy), the rollback step is
  skipped (`steps.last-good.outputs.tag != ''` guard).
