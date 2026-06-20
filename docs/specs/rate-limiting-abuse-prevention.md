# Spec: Rate-Limiting & API Abuse Prevention — Free-Layer Baseline

**Status**: Draft
**Date**: 2026-06-19
**Related**: `todo/TASKS.md` → "[L] Rate-limiting signup & API abuse"; ADR-016 (analytics/EMF pattern), ADR-001 (cost-conscious stack), `docs/specs/mobile-scan-discoverability.md` (the `POST /v1/events` endpoint), the backlog "Configure SES as Cognito email sender" task (signup-abuse pairing)

## Problem

Every route the browser can reach runs through a single Lambda, and **authentication is
verified _inside_ that Lambda**, not at the gateway. So even an unauthenticated or
garbage request costs a Lambda invocation before it's rejected. There is no rate limit,
no concurrency ceiling, and no cost alarm anywhere in the stack today (confirmed: no
`wafv2`, no throttle config, no counters). Three concrete exposures:

1. **Authenticated quota-drain.** `/v1/books/*` proxies Google Books, which has a finite
   daily quota. A single signed-in user (or a script with one valid token) can hammer
   search and exhaust the shared quota, breaking book lookup for _everyone_.
2. **Volumetric flood pays for Lambda.** Because auth runs in-Lambda, an HTTP flood to
   any path runs up Lambda + DynamoDB cost even while returning 401s.
3. **Signup/auth abuse.** Self-signup is open in prod; Cognito's default email mode is
   capped (~50 emails/day), so a cheap signup/forgot-password flood can exhaust the
   day's email quota and silently break verification for real new users.

The cost of not solving it is asymmetric: the app is low-profile, but a single bad actor
or runaway script could produce a surprise bill or a quiet outage (no email, drained
quota) with no alerting to catch it.

## Approach: free layers first, paid WAF as an evidence-driven upgrade

AWS WAF **cannot attach to this API** — it's an API Gateway **HTTP API (v2)**, which WAF
does not support (only REST APIs, CloudFront, ALB, AppSync, Cognito user pools, App
Runner, Verified Access, Amplify). WAF would therefore have to sit on the **CloudFront**
distribution (us-east-1) and/or the **Cognito user pool** (us-west-2) — each a fixed
**~$5/web-ACL/month** subscription. At this app's scale the entire WAF cost _is_ that
subscription; request/email/DynamoDB volume rounds to zero.

So this spec ships the controls that cost **$0/month** and cover most of the realistic
threat, and **defers paid WAF** to a documented escalation path (P2) triggered by actual
observed abuse. The free layers:

| Layer                              | Covers                                                               | Why it's free              |
| ---------------------------------- | -------------------------------------------------------------------- | -------------------------- |
| API Gateway stage throttling       | L7 flood — sheds excess **before Lambda** (429)                      | Built-in to HTTP API v2    |
| Lambda max (reserved) concurrency  | Hard ceiling on attack-driven Lambda/DynamoDB spend                  | Built-in                   |
| App-level per-user cap (in-Lambda) | Quota-drain & per-user fairness; **covers the `execute-api` bypass** | Just code                  |
| AWS Budget / billing alarm         | Insurance — find out in hours, not at month-end                      | First 2 budgets free       |
| CloudWatch abuse metrics (EMF)     | The escalation signal that says "now buy WAF"                        | Reuses ADR-016 EMF pattern |
| AWS Shield Standard                | L3/L4 network DDoS on CloudFront/Route53                             | Auto-on, already active    |
| Cognito built-in throttling        | Account-wide signup/login/reset RPS quotas                           | Already active             |

## Goals

1. **Bound worst-case cost.** A flood or runaway script cannot produce an unbounded
   Lambda/DynamoDB bill — there is a hard concurrency ceiling and a budget alarm.
2. **Protect the Google Books quota** from single-user drain via a per-user app-level
   cap on `/v1/books/*`, returning a correct `429` with `Retry-After`.
3. **Shed volumetric junk before Lambda** with a gateway-level throttle, so floods stop
   costing per-invocation money.
4. **Know when to escalate.** Emit a rate-limit/abuse metric so the decision to buy WAF
   (or move to SES) is driven by data, not guesswork.
5. **Spend $0/month** for the baseline, with a clean, documented on-ramp to paid WAF.

## Non-Goals

- **Deploying AWS WAF now.** Both the CloudFront web ACL (API/proxy abuse) and the
  Cognito web ACL (signup) are **P2 / deferred** — added on evidence, not preemptively.
  Documented as an escalation path, not built here.
- **Signup-specific protection beyond what Cognito already enforces.** Per-IP signup
  throttling means a Cognito web ACL; it's most valuable _after_ the SES move (which
  raises the cost of an email flood). It **pairs with the separate "Configure SES as
  Cognito email sender" task**, not this one.
- **Per-IP application-level limiting.** The browser reaches the API through CloudFront,
  so the Lambda sees CloudFront's IP, not the user's — reliable per-IP belongs at the
  edge (WAF), which is deferred. App-level limiting keys on the authenticated `userId`.
- **A distributed/global exact counter.** v1 uses the simplest store that fits hobby
  concurrency; a strict global counter (DynamoDB) is a documented upgrade (P2), not a v1
  requirement.
- **Changing the auth model or any route's contract.** No endpoint behavior changes
  except the addition of `429` responses under sustained per-user abuse.

## User Stories

**App owner (Kevin)**

- As the operator, I want a hard ceiling on how much an attacker can make me spend, so
  that a flood is an annoyance, not a bill.
- As the operator, I want to be alerted when spend crosses a threshold, so that I learn
  about abuse in hours rather than at month-end.
- As the operator, I want a metric that tells me abuse is actually happening, so that I
  pay for WAF only when the data justifies it.

**Legitimate signed-in user**

- As a normal user, I want my own heavy-but-reasonable use to keep working, so that the
  abuse controls never block real cataloguing. (The per-user cap is set well above any
  human workflow.)
- As a normal user, when I _do_ trip a limit (e.g. a buggy client loop), I want a clear
  `429` with a `Retry-After`, so that a well-behaved client backs off instead of
  hammering.

**Abuser (negative persona)**

- As a script draining Google Books via one token, I should be capped per-user and
  start receiving `429`s, so that I cannot exhaust the shared quota.
- As a flood hitting the raw `execute-api` URL to bypass CloudFront, I should still be
  capped, because the per-user cap runs in-Lambda regardless of path.

## Requirements

### Must-Have (P0)

**P0-1 — API Gateway stage throttling (global circuit breaker).**
Set stage-level throttling on the API Gateway HTTP API (`packages/infra/lib/api-stack.ts`)
via `DefaultRouteSettings` (`ThrottlingRateLimit`, `ThrottlingBurstLimit`). Because the
API is a single catch-all `/{proxy+}` integration (Hono routes internally), the gateway
sees one route — so this is an **aggregate** limit across the whole API, a deliberate
blunt circuit breaker that caps Lambda blast radius.

- Defaults (calibratable, generous for a solo-user app): **rate 50 req/s, burst 100**.
- Acceptance:
  - Given sustained traffic above the configured rate, then API Gateway returns `429`
    for the excess **without invoking Lambda** (verified via the `Count` vs
    `IntegrationLatency`/invocation metrics).
  - Given normal single-user traffic, then no request is throttled.
  - The limits are CDK constants with a comment explaining the aggregate-vs-per-user
    split, and are asserted in `packages/infra/test/stacks.test.ts`.

**P0-2 — Lambda max (reserved) concurrency ceiling (cost cap).**
Set a `reservedConcurrentExecutions` cap on the API Lambda so attack-driven invocation
count is bounded.

- Default: **10** (hobby scale rarely exceeds a couple of concurrent invocations;
  calibratable). Tradeoff documented inline: a real spike beyond the cap also throttles,
  so the value must stay comfortably above expected peak.
- Acceptance:
  - Given concurrent invocations exceed the cap, then Lambda throttles the excess
    (API Gateway surfaces `429`/`5xx`) and no additional Lambda duration is billed.
  - The cap is a named CDK constant, asserted in the stack tests.

**P0-3 — App-level per-user rate cap on expensive routes.**
A Hono middleware applied to the **books** router (`/v1/books/*`) that counts requests
per authenticated `userId` over a fixed window and returns `429` with a `Retry-After`
header once the cap is exceeded. Path-independent by construction — it runs in-Lambda, so
it covers both the CloudFront path **and** direct `execute-api` hits.

- Defaults (calibratable, well above human use): **30 req/min and 300 req/hour per user**
  for `/v1/books/*`. Cheap DynamoDB-only routes (`/v1/shelf*`, `/v1/shelves*`) are **not**
  capped in v1 (no upstream quota to protect; the gateway throttle + concurrency cap
  already bound them).
- The `429` body uses a generic message (no internals), sets `Retry-After` (seconds), and
  is logged server-side; the limit constants live as named constants near the middleware.
- The middleware must **fail open** on its own internal error (a counter bug must never
  turn into a denial of service for legitimate users) — log and allow.
- Acceptance:
  - Given a user exceeds 30 requests to `/v1/books/search` within a minute, then the
    31st returns `429` with a `Retry-After` header and a generic body.
  - Given the window elapses, then the user's requests succeed again.
  - Given the rate-limit store/middleware throws internally, then the request is allowed
    (fail-open) and the error is logged with `console.error`.
  - Given two different users, then one user's cap never affects the other.
  - Unit-tested with a mocked clock (window rollover, boundary at the cap, per-user
    isolation, fail-open).

**P0-4 — Billing alarm / AWS Budget (insurance).**
A cost guardrail so runaway spend is noticed immediately. Document and/or codify an AWS
Budget (e.g. **$20/month**, alerts at 80% and 100% to Kevin's email). If codified in CDK
it lives in a small construct; if configured in-console it is captured in the runbook
(see Timeline). This is alerting, not prevention — it pairs with P0-2's hard cap.

- Acceptance: Given month-to-date spend crosses 80% of the budget, then an email alert
  fires. The budget threshold + recipient are recorded in the runbook.

**P0-5 — Abuse observability (the escalation signal).**
Emit a CloudWatch EMF metric when the app-level cap (P0-3) blocks a request, reusing the
ADR-016 `process.stdout.write` EMF pattern (namespace `Bookshelf/Abuse`, dimension on a
bounded `reason`, **no `userId`** in the metric — cardinality + privacy, per ADR-016).
This is the signal that tells us when observed abuse justifies buying WAF.

- Acceptance:
  - Given the per-user cap blocks a request, then a `Count` metric is emitted under
    `Bookshelf/Abuse` with a bounded `reason` dimension and no user identifier.
  - The metric is queryable/dashboardable with existing CloudWatch tooling (no new
    billable resource).

### Nice-to-Have (P1)

**P1-1 — Close the `execute-api` bypass at the edge (origin-secret header).**
Have CloudFront inject a secret custom origin header (value stored as a secret, not in
source) and have the Lambda reject requests lacking it with `403`. This makes the raw
`{id}.execute-api.us-west-2.amazonaws.com` URL stop working directly, so _all_ browser
traffic is forced through CloudFront (where a future WAF would see it). Free beyond
managing one secret.

- Note: affects the `api.bookshelf.whoiskevinrich.com` (MCP) path — MCP clients hit the
  API directly, not via CloudFront, so the check must **exempt the MCP domain/route** or
  the secret must be shared with the MCP origin. Resolve in system design (it's why this
  is P1, not P0).
- Acceptance:
  - Given a request to the API via CloudFront, then it carries the secret header and is
    served normally.
  - Given a request straight to the `execute-api` URL without the header, then it gets
    `403` before any business logic.
  - The secret is sourced from SSM/Secrets Manager (never committed), matching the
    existing Google-credentials pattern.

**P1-2 — Per-route differentiated app-level limits.**
Generalize P0-3's middleware so different route groups can carry different caps (e.g. a
tighter cap on `/v1/books/search` keyword search vs. `/isbn/:isbn` lookups), configured
in one place. Only worth it once real traffic shows distinct patterns.

### Future Considerations (P2) — the paid escalation path

Documented now so the baseline doesn't paint us into a corner:

- **CloudFront WAF web ACL (prod, ~$7/mo).** Add a CLOUDFRONT-scope web ACL (us-east-1)
  with a rate-based rule (and optionally a scoped rule for `/api/v1/books/*`), shipped in
  **Count mode first** to calibrate, then flipped to **Block**. This is what buys
  per-IP surgical blocking and edge filtering the free layers can't. Trigger: the
  `Bookshelf/Abuse` metric (P0-5) or billing alarm (P0-4) shows real, sustained abuse.
  Keep to 1–2 rate rules, **no full request logging** (use free metrics), and **avoid**
  the intelligent-threat managed groups (Bot Control / ATP / ACFP — the $10/mo ones).
- **Cognito user-pool WAF web ACL (prod, ~$6/mo).** Per-IP signup/auth throttling.
  **Pairs with the SES task** — most valuable once email has real per-send cost.
- **DynamoDB-backed counter.** If concurrency grows enough that the in-Lambda counter
  (P0-3) leaks meaningfully across warm containers, move to an atomic DynamoDB counter
  with a TTL attribute (requires enabling TTL on the table). Strictly-correct global
  limit at ~$0 marginal cost, but unnecessary complexity at current scale.

## Success Metrics

**Leading (days–weeks):**

- **Zero legitimate `429`s.** No real user session trips the per-user cap. Measured via
  the `Bookshelf/Abuse` metric staying ~flat under normal use. If real users hit it,
  the cap is too low — raise it.
- **Cost ceiling proven.** A synthetic burst test confirms Lambda invocations plateau at
  the concurrency cap and the gateway throttle returns `429` above the rate limit.

**Lagging (weeks–months):**

- **No surprise bills.** Month-over-month AWS cost stays flat; the budget alarm never
  fires from abuse (only, if ever, from real growth).
- **Quota stability.** No Google Books quota-exhaustion incidents attributable to a
  single user.
- **Escalation readiness.** If the abuse metric ever trends up, the WAF upgrade (P2) is
  a documented, hours-long change — measured by how fast we can respond, not by it
  never happening.

## Open Questions

Resolved with the operator before/within implementation:

- **Q1 — [engineering] App-level counter store.** _Recommend in-memory per-container
  Map_ for v1 (free, no schema change, adequate at hobby concurrency where usually one
  warm container handles a user's burst), with DynamoDB-atomic as the documented P2
  upgrade. **To ratify in the ADR.**
- **Q2 — [engineering/operator] Concrete numbers.** Gateway throttle (50 rps / 100
  burst), Lambda concurrency cap (10), per-user books cap (30/min, 300/hr) are starting
  defaults. Confirm they sit comfortably above real single-user peak before merge.
- **Q3 — [engineering] Is P1-1 (origin-secret bypass fix) in this PR or a fast-follow?**
  It's free but introduces a secret and an MCP-path exemption — non-trivial enough to
  split. Default: **fast-follow** unless the bypass is judged urgent.
- **Q4 — [operator] Is the AWS Budget codified in CDK or set in-console + runbook?**
  Default: **in-console + runbook** (budgets are account-wide, not app-stack-scoped;
  keeps the CDK app focused).
- **Q5 — [engineering] Environments.** All P0 controls are free → ship to **dev + prod**.
  (Confirm: the concurrency cap value may differ if dev should stay tiny.)

## Timeline Considerations

- **One PR carries the P0 baseline:** gateway throttle + concurrency cap (infra, ~few
  lines + tests), the per-user middleware (app, unit-tested), the EMF abuse metric, and
  the budget/runbook entry. No data migration, no new billable resource.
- **Documentation gate (CLAUDE.md Phase 4):** record the free-first-vs-WAF decision as an
  ADR (`docs/adrs/018-rate-limiting-free-layer-baseline.md`) + a row in
  `docs/decisions.md`; capture the budget/escalation steps in a runbook
  (`docs/runbooks/abuse-rate-limiting.md`).
- **Dependencies:** none blocking. The **SES task** is a natural sibling (it removes the
  50/day email-DoS for ~$0 and is the right home for signup-WAF) but is independent.
- **Suggested phasing:** v1 = all P0 (this PR). Fast-follow = P1-1 (bypass fix) + P1-2
  (per-route caps). Escalate to P2 (WAF) only when P0-5's metric or P0-4's alarm says so.
