# ADR-018: Rate-Limiting & API Abuse — Free-Layer Baseline, WAF Deferred

**Status**: Accepted
**Date**: 2026-06-19
**Related**: `docs/specs/rate-limiting-abuse-prevention.md`, ADR-001 (cost-conscious stack), ADR-008 (hybrid API exposure: CloudFront `/api/*` + `api.` domain), ADR-016 (EMF metrics via `process.stdout.write`)

## Context

The backlog item "[L] Rate-limiting signup & API abuse" assumed AWS WAF rate rules "in
front of CloudFront/API" plus an app-level cap. Two facts discovered during design
reshape the decision:

1. **AWS WAF cannot attach to this API.** The API is an API Gateway **HTTP API (v2)**.
   AWS WAF only protects CloudFront, **API Gateway REST APIs**, ALB, AppSync, **Cognito
   user pools**, App Runner, Verified Access, and Amplify — **not HTTP APIs**. So WAF
   could only sit on the **CloudFront** distribution (us-east-1, for the browser `/api/*`
   path) and/or the **Cognito user pool** (us-west-2, for signup). The raw
   `{id}.execute-api.us-west-2.amazonaws.com` URL and the `api.` MCP domain (ADR-008)
   bypass CloudFront entirely.
2. **The named endpoints are now authenticated.** Since the security hardening (#43) and
   `POST /v1/events` (#70/ADR-016), every `/v1/*` route runs `authMiddleware`. The
   backlog's "unauthenticated externally-proxying endpoints" no longer exist. The live
   threat model is: (a) authenticated **quota-drain** on `/v1/books/*` (Google Books),
   (b) **volumetric flood** that still pays for Lambda because auth runs _in-Lambda_, not
   at the gateway, and (c) **signup/auth abuse** against Cognito (default email mode caps
   ~50 emails/day → cheap email-DoS).

Forces at play:

- **Cost is the deciding factor** (ADR-001). WAF is a **fixed ~$5/web-ACL/month**
  subscription; at this app's volume the request/email/DynamoDB cost rounds to zero, so
  the bill _is_ the subscription count. Two web ACLs (CloudFront + Cognito) across one
  env ≈ $13–15/mo; dev+prod ≈ double.
- **Low-profile hobby app.** Real, sustained, targeted abuse is unlikely today; the
  realistic incident is a drive-by flood or a runaway script.
- **Several controls cost $0** and cover most of the threat, and **WAF can be added in an
  afternoon later** — there is little penalty for deferring it until evidence justifies
  the spend.

## Decision

**Ship the free-layer baseline now; defer paid WAF to an evidence-driven escalation
path.** Concretely:

1. **API Gateway stage throttling** (`DefaultRouteSettings`: rate 50 rps, burst 100) — an
   aggregate circuit breaker that sheds floods **before Lambda** (the API is a single
   `/{proxy+}` integration, so the gateway can only throttle in aggregate; per-path
   limits live in the app).
2. **Lambda `reservedConcurrentExecutions` cap** (8) — a hard ceiling on attack-driven
   Lambda/DynamoDB spend. Removed for a period when dev's account concurrency quota sat
   below the AWS unreserved floor, blocking deployment; restored for both envs once the
   quota was raised (BOOKSHELF-25).
3. **App-level per-user rate cap** — Hono middleware on `/v1/books/*` keyed on the
   authenticated `userId`, returning `429` + `Retry-After`. **Path-independent** (runs
   in-Lambda), so it covers the `execute-api` bypass and the `api.` domain. **Store:
   in-memory per-container counter** for v1 (free, no schema change; adequate at hobby
   concurrency), with a DynamoDB-atomic counter as the documented upgrade. **Fail-open**
   on internal error.
4. **AWS Budget / billing alarm** (~$20/mo, alert at 80%/100%) — insurance, captured in a
   runbook (account-wide, so not in the CDK app stack).
5. **Abuse EMF metric** (`Bookshelf/Abuse`, bounded `reason` dimension, no `userId`) via
   the ADR-016 `process.stdout.write` pattern — the signal that says "now buy WAF."

**Deferred (P2, on evidence):** CloudFront WAF web ACL (prod, ~$7/mo, **Count-mode
first**), Cognito user-pool WAF (pairs with the SES task), and the DynamoDB counter
upgrade. The `execute-api` origin-secret lockdown is a **P1 fast-follow** (free, but adds
a secret + an MCP-path exemption).

## Options Considered

### Option A — Free-layer baseline now, WAF deferred (chosen)

| Dimension     | Assessment                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------- |
| Complexity    | Low–Med (infra config + one middleware + a metric)                                          |
| Cost          | **$0/month**                                                                                |
| Coverage      | Cost ceiling, quota-drain, flood-before-Lambda, observability; **no per-IP edge filtering** |
| Reversibility | 2-way door — WAF is an afternoon to add later                                               |

**Pros:** $0; covers most realistic risk; path-independent per-user cap also closes the
bypass; gives a data signal before spending. **Cons:** no surgical per-IP blocking;
gateway throttle is aggregate (an abuser can trip the shared bucket → brief self-DoS);
in-memory counter is approximate under high concurrency.

### Option B — WAF-first (CloudFront + Cognito web ACLs) per the original backlog

| Dimension     | Assessment                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------ |
| Complexity    | Med–High (two web ACLs, two scopes/regions, cross-region cert/region rules, calibration)               |
| Cost          | **~$13–15/mo** (prod) / ~$26–30 (dev+prod)                                                             |
| Coverage      | Per-IP edge filtering + signup throttling; **misses the `execute-api` bypass** unless also locked down |
| Reversibility | 2-way door, but ongoing subscription                                                                   |

**Pros:** real per-IP blocking; matches the backlog's original framing; signup covered.
**Cons:** pays a fixed subscription preemptively for a low-profile app; **does not by
itself** protect against single-user quota-drain (rate-based rules are per-IP, and one
authenticated user is one IP) or the `execute-api` bypass — still needs the app-level
cap. So WAF-first buys the _expensive_ layer first and still requires the free one.

### Option C — Do nothing / rely on Cognito + Shield Standard only

| Dimension  | Assessment                                                                                               |
| ---------- | -------------------------------------------------------------------------------------------------------- |
| Complexity | None                                                                                                     |
| Cost       | $0                                                                                                       |
| Coverage   | L3/L4 DDoS (Shield) + Cognito's own throttle only; **no cost ceiling, no quota protection, no alerting** |

**Pros:** zero work. **Cons:** leaves the realistic exposures (quota-drain, flood-pays-
for-Lambda, surprise bill) wide open; no signal to know abuse is happening.

## Trade-off Analysis

The pivotal insight is that **WAF and the app-level cap protect different things**, and
the app-level cap is both free and the harder-to-replace one:

- **Quota-drain** is a _per-user_ problem (one valid token). WAF rate-based rules are
  _per-IP_ — one user is one IP, so WAF barely helps; the **app-level per-user cap is the
  actual control**, and it's free.
- **The `execute-api` bypass** means any edge-only control is incomplete; the **in-Lambda
  cap is the only thing that's path-independent**.
- **Volumetric cost** is bounded for free by the **gateway throttle + concurrency cap**,
  with **Shield Standard** already handling L3/L4 at no charge.
- What WAF _uniquely_ adds — **per-IP surgical blocking at the edge** — is real but is an
  _upgrade_, best bought when the **abuse metric (P0-5)** or **budget alarm (P0-4)** shows
  it's warranted, or when the **SES move** raises the cost of an email flood.

So Option A delivers the load-bearing protection at $0 and leaves a cheap, fast on-ramp to
Option B's edge layer — strictly better sequencing for a cost-sensitive, low-profile app.

## Consequences

**Easier:**

- Worst-case spend is bounded (concurrency cap) and alerted (budget) — no surprise bill.
- Google Books quota is protected from single-user drain at $0.
- Floods stop costing per-invocation money (shed at the gateway).
- The decision to spend on WAF becomes data-driven (the `Bookshelf/Abuse` metric).

**Harder / accepted:**

- No per-IP edge blocking until the WAF upgrade — a distributed flood within the gateway's
  aggregate limit still reaches Lambda (but is concurrency-capped).
- The aggregate gateway throttle can briefly self-DoS during an attack (everyone shares
  one bucket) — acceptable for a single-user-scale app, and the per-user cap keeps the
  expensive route fair.
- The in-memory counter is approximate across warm containers — acceptable at current
  concurrency; documented DynamoDB upgrade exists.

**To revisit:**

- Flip to the WAF escalation path (P2) when the abuse metric or budget alarm trends up.
- Move the counter to DynamoDB if concurrency grows enough to make the in-memory
  approximation leak materially.
- Fold **signup-WAF** into the **SES task** when that lands.
- If the `api.` MCP domain ever sees abuse, it needs its own control (it bypasses
  CloudFront) — the app-level cap already covers it; an edge control there would mean a
  REGIONAL WAF on a _REST_ API, i.e. an API redesign — out of scope.

## Action Items

1. [ ] `ApiStack`: add `DefaultRouteSettings` throttling (50 rps / 100 burst) + Lambda
       `reservedConcurrentExecutions: 10`, as named constants; assert in `stacks.test.ts`.
2. [ ] `apps/api`: add a per-user rate-limit middleware on `/v1/books/*` (`429` +
       `Retry-After`, fail-open, in-memory window store); unit-test window/boundary/isolation/
       fail-open with a mocked clock.
3. [ ] `apps/api`: emit the `Bookshelf/Abuse` EMF metric on a blocked request (reuse the
       `metrics.ts` pattern; no `userId`).
4. [ ] Configure the AWS Budget (~$20/mo, 80/100% alerts) and document it +
       the WAF escalation steps in `docs/runbooks/abuse-rate-limiting.md`.
5. [ ] Add the `docs/decisions.md` row; keep the spec's Open Questions (Q1–Q5) resolved.
