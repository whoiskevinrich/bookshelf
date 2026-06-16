# ADR-016: Client Analytics via `POST /v1/events` → CloudWatch EMF

**Status**: Accepted
**Date**: 2026-06-15
**Related**: `docs/specs/mobile-scan-discoverability.md` (Q4 / Analytics Options), ADR-001 (cost-conscious stack), ADR-011 (runtime config)

## Context

The web app has **no analytics pipeline** — no events are instrumented anywhere. The
Desktop → Mobile Scan Discoverability feature needs to measure three things from launch
(`hint_shown`, `hint_link_clicked`, `hint_dismissed`) to know whether the nudge works.

Constraints that shape the decision:

- **Low cost is the deciding factor** (ADR-001). Event volume is tiny — at most a few
  events per shelf/wishlist view, only for desktop users while the flag is on.
- We already run a Hono API on Lambda with `authMiddleware` and CloudWatch logging. No
  third-party telemetry is used anywhere, and the app has a no-PII-to-third-parties
  posture (self-hosted WASM in ADR-014, same spirit).
- This is the app's **first** event sink, so the shape should be reusable, not
  scan-hint-specific.

Options weighed (full trade-offs in the spec's _Analytics Options_): (A) a `POST
/v1/events` route emitting CloudWatch EMF; (B) Amazon CloudWatch RUM; (C) third-party
(Plausible/PostHog/GA4). B adds a per-event cost line and an App Monitor resource for
three events; C sends behavior off-platform and adds a consent surface.

## Decision

**1. Add one authenticated route, `POST /v1/events`**, to the existing API
(`apps/api/src/routes/events.ts`), mounted at `/v1/events` in `app.ts`, behind
router-level `authMiddleware` (consistent with every other `/v1` router).

**2. Contract — a generic, reusable envelope:**

```
POST /v1/events
{ "name": "hint_shown", "props": { "page": "shelf" } }   // props optional
→ 204 No Content        (fire-and-forget; body ignored on success)
→ 400                   (unknown name, malformed body, oversized props)
```

- `name` is validated against an **allowlist** (`hint_shown`, `hint_link_clicked`,
  `hint_dismissed` for v1). Allowlisting bounds metric cardinality — an open `name`
  field would let any client mint unbounded CloudWatch metrics.
- `props` is an optional flat `Record<string, string | number | boolean>`, capped at
  `PROPS_MAX_KEYS` (8) and `PROP_VALUE_MAX_LENGTH` (200) per the New Endpoint Checklist.
  Nested objects/arrays rejected. Validated props are written as a nested field on the
  EMF log line (queryable in Logs Insights) but are **not** metric dimensions, so they
  never widen metric cardinality.
- The global 64 KB `bodyLimit` already applies; no tighter per-route cap needed for a
  payload this small, but the prop caps prevent log bloat.

**3. Emit EMF as a structured `console.log` line — no new dependency.** Embedded Metric
Format is just a JSON log line with an `_aws` envelope; CloudWatch Logs auto-extracts
metrics from it. We do **not** add `@aws-lambda-powertools/metrics` or call
`PutMetricData` (avoids both a dependency and per-API-call cost). A tiny
`emitMetric(name, dimensions)` helper writes:

```jsonc
{
  "_aws": {
    "Timestamp": 1718500000000,
    "CloudWatchMetrics": [
      {
        "Namespace": "Bookshelf/WebEvents",
        "Dimensions": [["event"]],
        "Metrics": [{ "Name": "Count", "Unit": "Count" }],
      },
    ],
  },
  "event": "hint_shown",
  "Count": 1,
}
```

**4. No user identifier in metrics or logs.** The Cognito `sub` is available from the
auth context but is **not** emitted — it adds metric cardinality and is unnecessary for
count-based metrics. This keeps the endpoint privacy-clean and cheap. (The lagging
"desktop view → mobile session within 24h" metric in the spec — Q6 — would need a
correlation id; explicitly **deferred**, not built here.)

**5. Client event sink — `apps/web/src/lib/analytics.ts`.** A single
`track(name, props?)` that POSTs via the existing `authedFetch`, **fire-and-forget**:
failures are swallowed (an analytics ping must never break or block the UI). `track`
never throws and never awaits in the render path.

## Consequences

- **Cost:** marginal Lambda invocations + a trickle of CloudWatch Logs ingestion.
  Effectively rounding error at this volume; no new billable resource.
- **Reusable:** any future feature calls `track("some_event", …)` and adds the name to
  the server allowlist — no new infrastructure.
- **Security:** new endpoint follows the New Endpoint Checklist (auth, name allowlist,
  prop caps, 400 on bad input, generic 5xx). No raw exception text in responses.
- **Limits:** EMF count metrics only; no funnels/retention/session correlation. If we
  later need richer analysis, revisit (CloudWatch RUM or a warehouse) — this endpoint
  remains a valid lightweight ingestion point regardless.
- **Observability:** metrics appear under the `Bookshelf/WebEvents` namespace; can be
  dashboarded/alarmed with existing CloudWatch tooling (ADR-aligned, no new stack).

## What I'd revisit as it grows

- If event volume or distinct-name count rises materially, move metric emission behind a
  sampled/batched client buffer to cut request count.
- If we need per-user funnels, introduce an anonymous correlation id (Q6) and a query
  layer (Logs Insights or a warehouse) rather than more metrics.
