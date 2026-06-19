# Runbook: Abuse / Rate-Limiting & Cost Controls

Operating the free-layer abuse-prevention baseline (ADR-018), and the steps to
escalate to paid AWS WAF **when the data says so** — not before.

---

## What's deployed (the free layers)

| Control                                        | Where                                                               | What it does                                                                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Stage throttling (50 rps / 100 burst)          | `packages/infra/lib/api-stack.ts` → API GW default stage            | Aggregate circuit breaker; sheds floods with `429` **before Lambda**                                                                  |
| Lambda `reservedConcurrentExecutions: 10`      | `api-stack.ts` → `ApiFunction`                                      | Hard ceiling on attack-driven Lambda/DynamoDB spend                                                                                   |
| Per-user cap (30/min, 300/hr) on `/v1/books/*` | `apps/api/src/middleware/rate-limit.ts`, wired in `routes/books.ts` | Protects the shared Google Books quota; `429` + `Retry-After`; path-independent (covers the `execute-api` bypass + `api.` MCP domain) |
| `Bookshelf/Abuse` EMF metric                   | emitted on every per-user block                                     | The escalation signal                                                                                                                 |
| AWS Budget alarm                               | account-wide (see below)                                            | Cost insurance — alerts, doesn't block                                                                                                |
| Shield Standard, Cognito throttling            | AWS-managed, always on                                              | L3/L4 DDoS; account-wide auth RPS quotas                                                                                              |

The two infra limits are named constants at the top of `api-stack.ts`; the
per-user limits are named constants at the top of `routes/books.ts`. To retune,
change the constant and redeploy — no logic change.

---

## Watching for abuse

The `Bookshelf/Abuse` namespace carries one metric: `Count`, dimensioned by
`event` (`rate_limited_books`). It increments only when the **per-user** cap
blocks a request — so any non-zero value means a real user (or a script with a
valid token) is hitting the books routes hard.

- **CloudWatch → Metrics → `Bookshelf/Abuse`** to chart it.
- **Logs Insights** over `/aws/lambda/bookshelf-api` — the block line carries a
  `window` prop (`minute`|`hour`) but **no userId** (privacy/cardinality, ADR-016).
- Calibration rule of thumb: if a _legitimate_ session ever trips it, the cap is
  too low — raise `BOOKS_PER_MINUTE` / `BOOKS_PER_HOUR` in `routes/books.ts`.
  Sustained blocks from many sources = real abuse → consider the WAF escalation.

---

## AWS Budget (cost insurance)

Budgets are account-wide, so they live outside the CDK app (which is per-stack).
Set one per AWS account (dev `058308164167`, prod `071526660165`).

**Console (recommended):** Billing → Budgets → _Create budget_ → Cost budget →
monthly, amount **$20** → alert thresholds at **80%** and **100%** of actual →
notify `whoiskevinrich@gmail.com`.

**CLI (prod example, PowerShell):**

```powershell
aws budgets create-budget `
  --profile prod/AWSPowerUserAccess `
  --account-id 071526660165 `
  --budget '{\"BudgetName\":\"bookshelf-monthly\",\"BudgetLimit\":{\"Amount\":\"20\",\"Unit\":\"USD\"},\"TimeUnit\":\"MONTHLY\",\"BudgetType\":\"COST\"}' `
  --notifications-with-subscribers '[{\"Notification\":{\"NotificationType\":\"ACTUAL\",\"ComparisonOperator\":\"GREATER_THAN\",\"Threshold\":80},\"Subscribers\":[{\"SubscriptionType\":\"EMAIL\",\"Address\":\"whoiskevinrich@gmail.com\"}]}]'
```

The budget alerts; the Lambda concurrency cap is what actually _bounds_ the spend.

---

## Escalation: adding AWS WAF (only on evidence)

Trigger: the `Bookshelf/Abuse` metric or the budget alarm shows sustained,
real abuse, **or** signup moves to SES (raising the cost of an email flood).

**Important constraint (ADR-018):** AWS WAF **cannot** attach to this API — it's
an API Gateway **HTTP API (v2)**, which WAF doesn't support. WAF attaches only to:

- the **CloudFront** distribution (CLOUDFRONT scope, **us-east-1**) — for the
  browser `/api/*` path and the whole site; and/or
- the **Cognito user pool** (REGIONAL scope, **us-west-2**) — for signup/auth.

### CloudFront WAF (API/proxy abuse, ~$7/mo)

1. New `WafStack` (or a construct in `WebStack`) in **us-east-1**: a
   `CfnWebACL` (scope `CLOUDFRONT`) with **1–2 rate-based rules** — a blanket
   per-IP rule, optionally a tighter one scoped to `/api/v1/books/*`.
2. **Ship in `Count` mode first** (`OverrideAction`/rule action = `count`). Watch
   the WAF metrics for a week to confirm the thresholds don't catch real users.
3. Flip the rule action to `Block` once calibrated (one-line change).
4. Associate via the CloudFront distribution's `WebACLId`.
5. **Do not** enable full request logging (use the free WAF CloudWatch metrics +
   console sampled requests). **Do not** use the intelligent-threat managed
   groups (Bot Control / ATP / **ACFP**) — those are the $10/mo + per-request
   ones; plain rate-based rules are all that's needed.

Residual: the raw `execute-api` URL still bypasses CloudFront. The per-user cap
already covers it; to close it fully, see the origin-secret fast-follow (spec
P1-1).

### Cognito WAF (signup abuse, ~$6/mo)

Pairs with the **"Configure SES as Cognito email sender"** task. A REGIONAL
`CfnWebACL` (us-west-2) with a rate-based rule on signup/auth, associated with
the user pool via `AssociateWebACL`. Most valuable after SES, when an email
flood has real per-send cost rather than just exhausting the ~50/day default cap.

---

## Quick reference: retuning

| Want to…                              | Change                                              | File              |
| ------------------------------------- | --------------------------------------------------- | ----------------- |
| Loosen/tighten the global flood limit | `API_THROTTLE_RATE` / `API_THROTTLE_BURST`          | `api-stack.ts`    |
| Raise the cost ceiling                | `API_MAX_CONCURRENCY`                               | `api-stack.ts`    |
| Adjust per-user book limits           | `BOOKS_PER_MINUTE` / `BOOKS_PER_HOUR`               | `routes/books.ts` |
| Limit another expensive route         | add `userRateLimit(...)` after its `authMiddleware` | that router       |

All are redeploy-only (no migration, no new billable resource).
