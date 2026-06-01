# ADR-005: AWS Lambda Powertools for SSM Parameter Retrieval

**Status:** Accepted  
**Date:** 2026-06-01  
**Deciders:** Solo developer

---

## Context

The API Lambda needs the Google Books API key at runtime. The key is stored in SSM Parameter Store as a SecureString at `/bookshelf/google-books-api-key`. Several approaches for injecting it into the Lambda were evaluated before landing here:

1. CDK `valueForStringParameter` — rejected; only works with `String` type, not `SecureString`
2. CDK `valueFromLookup` — rejected; requires a concrete account at synth time, breaking local deploys
3. `SecretValue.ssmSecure()` / hand-rolled `{{resolve:ssm-secure:...}}` — rejected; deprecated or produces a CloudFormation token that can't be resolved for Lambda env vars in all cases
4. Stack prop from CI secret — rejected; couples the CDK deploy command to a GitHub Actions secret, making local deploys awkward and violating the "SSM is the source of truth" principle

The core requirement: read a SecureString from SSM at Lambda invocation time, cache the value to avoid redundant API calls, and fall back gracefully in local development.

---

## Options Considered

### Option 1: AWS SDK `SSMClient` directly

Instantiate `@aws-sdk/client-ssm` inside the Lambda and call `GetParameter` with `WithDecryption: true` on cold start.

**Pros:**
- No additional dependency beyond the AWS SDK already in the project
- Full control over caching logic

**Cons:**
- Requires hand-rolling cache invalidation (TTL tracking, in-memory store)
- Boilerplate: client instantiation, error handling, type narrowing on the response
- Easy to introduce bugs — e.g. accidentally re-fetching on every invocation, or caching indefinitely

### Option 2: AWS Lambda Powertools `SSMProvider` (chosen)

`@aws-lambda-powertools/parameters` wraps SSM (and other parameter sources) with built-in in-process caching and a clean async API.

**Pros:**
- Built-in TTL-based cache — `maxAge` option, default 5 seconds, configurable up to any value
- `decrypt: true` option handles SecureString transparently
- No synth-time AWS account dependency; no CloudFormation token resolution issues
- Falls back naturally: reads `GOOGLE_BOOKS_API_KEY` env var locally (where `GOOGLE_BOOKS_API_KEY_SSM_NAME` is absent)
- Well-maintained, AWS-owned library; consistent with the Lambda Powertools ecosystem if adopted more broadly later

**Cons:**
- Adds a new runtime dependency (`@aws-lambda-powertools/parameters`)
- Slightly larger Lambda bundle (~50 KB gzipped for the parameters module)

### Option 3: `POWERTOOLS_PARAMETERS_MAX_AGE` environment variable

Powertools also supports a global default TTL via env var instead of per-call `maxAge`.

Not chosen as the primary mechanism because per-call `maxAge` is explicit in the code and survives if the env var is ever unset.

---

## Decision

**`@aws-lambda-powertools/parameters` `SSMProvider` (Option 2).**

The deciding factors:

1. **No synth-time constraints.** Unlike every CDK-level approach tried, Powertools runs at Lambda invocation time — no dependency on `CDK_DEFAULT_ACCOUNT`, no CloudFormation token quirks.

2. **Cache is free.** The default 5-second cache is already useful; setting `maxAge: 604800` (7 days) means a warm Lambda pool fetches the key once and holds it for the lifetime of typical container reuse. Google Books API keys rarely rotate — 7 days is the right tradeoff between freshness and SSM API call volume.

3. **`decrypt: true` just works.** SecureString handling is a one-liner rather than a parameter to `GetParameter` with all its error surface.

4. **Leaves a graceful local fallback.** `GOOGLE_BOOKS_API_KEY_SSM_NAME` is only set in the deployed Lambda. When absent, the provider falls back to `GOOGLE_BOOKS_API_KEY` from `.env.local` — no Powertools SSM call, no AWS credentials required locally.

---

## Implementation

`apps/api/src/lib/books/providers/index.ts`:

```ts
const ssmProvider = new SSMProvider();
const API_KEY_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

export async function getActiveProvider(): Promise<BookProvider> {
  const ssmName = process.env["GOOGLE_BOOKS_API_KEY_SSM_NAME"];
  const apiKey = ssmName
    ? ((await ssmProvider.get(ssmName, { maxAge: API_KEY_TTL_SECONDS, decrypt: true })) ?? "")
    : (process.env["GOOGLE_BOOKS_API_KEY"] ?? "");
  return factory(apiKey);
}
```

`packages/infra/lib/api-stack.ts` passes the parameter name, not the value:

```ts
environment: {
  GOOGLE_BOOKS_API_KEY_SSM_NAME: '/bookshelf/google-books-api-key',
}
```

The Lambda role has a least-privilege `ssm:GetParameter` policy scoped to the exact parameter ARN.

---

## Consequences

**Easier:**
- Key rotation: update the SSM parameter; the new value is picked up within 7 days (or on the next cold start if the container is recycled sooner)
- Local dev: no AWS credentials needed to run the books routes; `.env.local` supplies `GOOGLE_BOOKS_API_KEY` directly
- Future parameters: `SSMProvider` can retrieve other secrets the same way with no additional setup

**Harder:**
- Immediate key rotation requires redeploying the Lambda (or waiting up to 7 days for cache expiry); this is acceptable for an API key with no breach history
- `getActiveProvider()` is now `async`; all callers must `await` it

**To revisit:**
- If key rotation SLA tightens, reduce `maxAge` or trigger a Lambda redeployment on rotation via EventBridge + SSM parameter change notifications
- If more secrets are added, consider centralising all SSM lookups in an `initConfig()` function called once at cold start
