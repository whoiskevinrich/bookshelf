# Spec: Production Deployment & Custom Domain

**Status**: Approved design — pending implementation
**Date**: 2026-06-04
**Related**: ADR-008 (decision record), ADR-009 (env selection), `docs/runbooks/prod-domain-setup.md` (operations)

> **Note:** the DNS mechanism is **CNAME records at Hover + manual ACM DNS
> validation**, not Route53 subdomain delegation. Delegation was the initial plan
> but Hover's DNS editor has no `NS` record type (see the ADR-008 revision). This
> spec reflects the final, implemented design.

## Problem

The app deploys to a dev AWS account on AWS-generated hostnames
(`*.cloudfront.net`, `*.execute-api.*.amazonaws.com`). To ship to production we
need:

- The SPA served at `https://bookshelf.whoiskevinrich.com`.
- The API reachable on a stable, canonical hostname for **both** the browser and
  the future MCP server (ADR-001 treats the API + MCP server as the primary
  deliverables; the web UI is a secondary, interchangeable consumer).
- Valid auto-renewing TLS and HTTP→HTTPS redirect.
- Deployment to the **separate prod AWS account** (already provisioned —
  `docs/runbooks/cicd-setup.md`), driven by the existing `promote.yml`.

The domain `whoiskevinrich.com` is registered at **Hover**, whose DNS editor has
no `NS` record type, and which actively hosts apex/`www`/`presentation`/`home` HTTP
forwards. So DNS stays at Hover.

## Requirements

**Functional**

- SPA at `https://bookshelf.whoiskevinrich.com`.
- Browser reaches the API same-origin under `/api/*` (no CORS).
- MCP / programmatic clients reach the API at a canonical
  `https://api.bookshelf.whoiskevinrich.com` (clean `/v1/...` paths, no prefix).
- Cognito self-signup enabled in prod (selected via `-c env=prod`; see ADR-009).

**Non-functional**

- Cost ≈ $0/month at hobby scale (no Route53 hosted zone; certs free).
- Existing versioned-prefix rollback (`web-stack.ts`) preserved.
- Apex `whoiskevinrich.com`, Hover email, and the existing Hover forwards stay
  untouched.

**Constraints (these shape the design)**

1. **CloudFront ACM certs must live in `us-east-1`**, but the app's stacks deploy
   in `us-west-2` (GitHub var `AWS_REGION=us-west-2`). This forces a cross-region
   certificate for the CloudFront distribution.
2. **Hover has no `NS` record type** → no subtree delegation to Route53. DNS stays
   at Hover; ACM certs use manual DNS validation (a CNAME added by hand), and the
   public hostnames are CNAMEs → the CloudFront / API custom-domain names.
3. A full nameserver move to Route53 would break Hover's existing HTTP forwards
   (Route53 has none), so it is rejected.

## Decision summary — Hybrid

One Hono Lambda behind API Gateway, exposed through **two doors**:

- **Browser door** — `bookshelf.whoiskevinrich.com/api/*` via CloudFront
  (same-origin, CORS eliminated).
- **API door** — `api.bookshelf.whoiskevinrich.com` via an API Gateway custom
  domain (canonical `/v1/...` paths for MCP and any programmatic client).

DNS stays at **Hover**: manual ACM-validation CNAME(s), plus `bookshelf` and
`api.bookshelf` CNAMEs pointing at the CloudFront / API custom-domain names.

Full rationale and alternatives in **ADR-008**.

## Architecture

```
            Hover (registrar + DNS host — apex, email, forwards untouched)
            whoiskevinrich.com   ns1/ns2.hover.com  ← NOT changed
              │  Manually-added CNAME records:
              │   _<hash>.bookshelf → _<val>.acm-validations.aws   (ACM validation)
              │   bookshelf        → dXXXX.cloudfront.net           (CloudFront)
              │   api.bookshelf    → d-XXXX.execute-api.us-west-2.amazonaws.com (API GW)
              ▼
   bookshelf.whoiskevinrich.com            api.bookshelf.whoiskevinrich.com
             ▼                                       ▼
   ┌───────────────────────┐          ┌──────────────────────────┐
   │ CloudFront            │          │ API GW custom domain      │
   │ cert: ACM us-east-1   │          │ cert: ACM us-west-2        │
   │ (manual DNS validation)│         │ (manual DNS validation)    │
   │ /api/* → CF Function  │          │                           │
   │   strips "/api" ──────┼────┐     │  /v1/... (no rewrite) ─────┼──┐
   │ /*     → S3 (OAC)     │    │     └──────────────────────────┘  │
   └───────────────────────┘    │                                   │
                                 └──────────► API Gateway HTTP API ◄─┘
                                                    │
                                              Lambda (Hono)  — one app, /v1 + /health
                                                    │
                                              DynamoDB (single table)
```

One Hono app, one Lambda. The browser hits `/api/v1/shelf`; a CloudFront Function
strips `/api` so Hono's existing `/v1/...` routes match unchanged. MCP hits
`api.bookshelf.whoiskevinrich.com/v1/shelf` directly — no prefix, no CDN hop.

## CDK stack layout

Four stacks. No Route53 — DNS lives at Hover.

| Stack | Region | Responsibility |
| --- | --- | --- |
| `BookshelfCdnCert` | `us-east-1` | ACM cert for `bookshelf.whoiskevinrich.com` + `*.bookshelf.whoiskevinrich.com` (CloudFront). **Manual DNS validation** (`fromDns()` with no zone). `crossRegionReferences: true`. |
| `BookshelfAuth` | `us-west-2` | Cognito (unchanged); self-signup enabled when `env=prod`. |
| `BookshelfApi` | `us-west-2` | Existing API + **regional** ACM cert (`*.bookshelf.whoiskevinrich.com`, manual validation), `apigatewayv2.DomainName` + `ApiMapping`, and a `ApiCnameTargetOutput` for the `api.bookshelf` CNAME. CORS dropped. |
| `BookshelfWeb` | `us-west-2` | CloudFront `domainNames`/`certificate` (from `BookshelfCdnCert`), the `/api/*` behavior + path-strip Function, and a `WebCnameTargetOutput` for the `bookshelf` CNAME. `crossRegionReferences: true`. |

## Key construct changes

### `BookshelfCdnCert` (new, us-east-1)

```ts
this.certificate = new acm.Certificate(this, "Certificate", {
  domainName: "bookshelf.whoiskevinrich.com",
  subjectAlternativeNames: ["*.bookshelf.whoiskevinrich.com"],
  validation: acm.CertificateValidation.fromDns(), // no zone → manual; deploy blocks until validated
});
```

### `WebStack` (modified)

```ts
// Distribution props
domainNames: ["bookshelf.whoiskevinrich.com"],
certificate: props.domain.certificate,        // cross-region from BookshelfCdnCert
additionalBehaviors: {
  "/api/*": {
    origin: new cloudfrontOrigins.HttpOrigin(props.domain.apiExecuteApiDomain),
    viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    cachePolicy: CachePolicy.CACHING_DISABLED,
    // forwards Authorization; drops Host so API GW accepts the request
    originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
    allowedMethods: AllowedMethods.ALLOW_ALL,
    functionAssociations: [{ function: stripApiPrefixFn, eventType: VIEWER_REQUEST }],
  },
},

// CNAME target to create at Hover: bookshelf → this value
new cdk.CfnOutput(this, "WebCnameTargetOutput", { value: distribution.distributionDomainName });
```

CloudFront Function (viewer request):

```js
function handler(event) {
  var req = event.request;
  req.uri = req.uri.replace(/^\/api/, "");
  if (req.uri === "") req.uri = "/";
  return req;
}
```

### `ApiStack` (modified)

- Add a regional ACM cert for `*.bookshelf.whoiskevinrich.com`, **manual DNS
  validation** (`fromDns()` with no zone).
- Add `apigatewayv2.DomainName` + `ApiMapping` binding the HTTP API to
  `api.bookshelf.whoiskevinrich.com`.
- Output `ApiCnameTargetOutput` = the custom domain's `regionalDomainName` (the
  CNAME target for `api.bookshelf` at Hover).
- **Remove `corsPreflight`** when `sameOrigin` is set — the browser is same-origin
  via CloudFront `/api/*` and MCP is non-browser, so no client needs CORS. All
  deployed envs (dev, prod-interim, prod) are same-origin; the permissive-CORS
  fallback only applies to a hypothetical cross-origin SPA. (Resolves the
  `// tightened to CloudFront domain` TODO in `api-stack.ts`.)

### `bin/bookshelf.ts` (wiring)

```ts
const cdnCert = new CdnCertStack(app, "BookshelfCdnCert", {
  env: usEast1Env, domainName: webHostname, subjectAlternativeNames: [wildcard],
});
const auth = new AuthStack(app, "BookshelfAuth", { env, allowSelfSignUp: config.allowSelfSignUp });
const api  = new ApiStack(app, "BookshelfApi", {
  env, /* …auth ids */, domain: { apiHostname, certificateDomainName: wildcard },
});
const web  = new WebStack(app, "BookshelfWeb", {
  env, version, crossRegionReferences: true,
  domain: { certificate: cdnCert.certificate, webHostname, apiExecuteApiDomain: api.executeApiDomain },
});
web.addDependency(cdnCert);
web.addDependency(api);
```

Environment is selected by `-c env=dev|prod` (ADR-009): the whole `if (config.domain)`
block above only materializes for `env=prod`.

## Deployment sequence (first-time bootstrap)

DNS validation is manual, so the first prod deploy is hands-on (steady-state
`promote.yml` is hands-off). Full steps in `docs/runbooks/prod-domain-setup.md`:

1. `cdk deploy BookshelfCdnCert -c env=prod` → **blocks**; read the ACM validation
   CNAME (ACM console / CLI) → add it at Hover → cert issues → deploy completes.
2. `cdk deploy BookshelfAuth BookshelfApi -c env=prod` → the API cert validates
   against the same CNAME (wildcard); the API custom domain + mapping are created.
3. Build web (`VITE_API_BASE_URL=/api`) + `cdk deploy BookshelfWeb -c env=prod`.
4. Read `WebCnameTargetOutput` / `ApiCnameTargetOutput` → add `bookshelf` and
   `api.bookshelf` CNAMEs at Hover.
5. Verify.

## Frontend & CI changes

- **SPA config is loaded at runtime from `/config.json`** (written to S3 by
  `WebStack` from the Auth/API stack properties at deploy time — ADR-011), so the
  web build takes **no `VITE_*` env**. `apiBaseUrl` resolves to `/api` (same-origin
  via CloudFront) for prod; local dev falls back to `.env.local`.
- `promote.yml` (steady state): `cdk deploy --all -c env=prod` — the certs/domains
  are no-ops after the one-time bootstrap. Environment is selected by the single
  `-c env=dev|prod` flag (ADR-009), not separate `-c domain`/`-c allowSelfSignUp`.
- Smoke tests target the execute-api URL (API logic, no DNS dependency); manual
  verification hits the custom domains.

## MCP implications (why hybrid)

`apps/mcp` (TASKS.md Phase 3) is a non-browser consumer with a typed
`lib/api-client.ts`. Routing the API *only* through CloudFront would leave it with
no clean base URL — it would have to either eat the `/api` prefix + path-rewrite
Function or hardcode the volatile execute-api URL. The dedicated
`api.bookshelf.whoiskevinrich.com` door gives MCP a stable canonical base
(`/v1/...`, no rewrite, no CDN hop), honoring ADR-001's "API is a standalone
service; web and MCP are interchangeable consumers."

**Out of scope here, required before building `apps/mcp`:** the MCP auth model —
user-delegated JWT vs. a Cognito machine `client_credentials` flow (confidential
client + resource server + custom scopes + Cognito domain). JWKS verification in
the Lambda is unaffected by domain routing. Track as its own ADR alongside
`docs/specs/mcp-server.md`.

## Cost

| Item | Monthly |
| --- | --- |
| Route53 | $0 — not used (DNS at Hover) |
| ACM certs (both) | $0 |
| CloudFront | within always-free 1 TB + 10M req tier → ~$0 |
| CloudFront Function | 2M free/mo, then $0.10/M → ~$0 |
| API Gateway custom domain | no per-domain charge |

Total ≈ **$0/month** above existing usage. The cost is operational, not financial:
manual DNS records + manual cert validation.

## Trade-offs

| Decision | Chosen | Trade-off accepted |
| --- | --- | --- |
| DNS | CNAME at Hover (no Route53) | Manual records + manual cert validation (deploy blocks); apex + forwards + email stay at Hover untouched. |
| API exposure | Hybrid (CloudFront `/api` + `api.` subdomain) | Two doors / two certs to reason about; in exchange, no CORS for the browser and a clean canonical URL for MCP. |
| Cert region | Separate `us-east-1` cert stack + cross-region ref | Extra stack + one cross-region reference — unavoidable given CloudFront's `us-east-1` requirement vs. `us-west-2` app stacks. |
| Deploy | Manual first-time bootstrap | First prod deploy is hands-on (cert validation + CNAMEs); documented in the runbook. Subsequent deploys are `cdk deploy --all -c env=prod`. |

## Namespace convention (personal multi-app domain)

`whoiskevinrich.com` is a personal domain expected to host multiple projects, so
the namespace follows a fixed convention (ADR-008):

> **Each app owns a subtree — `<app>.whoiskevinrich.com`. Services nest inside it —
> `<service>.<app>.whoiskevinrich.com`.**

- `bookshelf.whoiskevinrich.com` (app), `api.bookshelf.whoiskevinrich.com` (API),
  future `mcp.bookshelf.whoiskevinrich.com` (remote MCP server).
- A future project `foo` is its own subtree `foo.whoiskevinrich.com` +
  `api.foo.whoiskevinrich.com`, in its own AWS account.
- With DNS at Hover, `api.bookshelf.…` (nested) is chosen over `bookshelf-api.…`
  (flat sibling) because the per-subtree wildcard cert `*.bookshelf.whoiskevinrich.com`
  covers every nested host with one cert and one shared validation CNAME, while a
  flat sibling would need its own cert + validation record. No shared
  `api.whoiskevinrich.com` — each app owns its API hostname.
- **Per-subtree wildcard certs:** `*.bookshelf.whoiskevinrich.com` (+ subtree apex
  as a SAN), one in `us-east-1` (CloudFront) and one in `us-west-2` (API). Both
  validate the same wildcard, so ACM typically emits **one shared validation CNAME**
  — adding `www.`/`admin.`/`mcp.` later needs no new cert or record.

## What we'd revisit as it grows

- Apex / `www` redirect to the app (a Hover redirect, like the existing ones); apex
  intentionally stays at Hover.
- WAF on CloudFront if self-signup invites abuse.
- Short-TTL CloudFront caching for the public book-search/ISBN GETs to cut Google
  Books calls (currently `CACHING_DISABLED` for all of `/api/*`).
- Revisiting Route53 (subdomain delegation) if DNS ever moves off Hover — it would
  restore automated cert validation and alias records.
```
