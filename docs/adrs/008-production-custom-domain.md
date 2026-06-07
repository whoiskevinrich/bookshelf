# ADR-008: Production Custom Domain & Hybrid API Exposure

**Status**: Accepted
**Date**: 2026-06-04

> **Revision (2026-06-04):** the DNS mechanism changed during implementation.
> Subdomain delegation (a Route53 zone + NS records at Hover) was the initial
> choice, but **Hover's DNS editor offers no `NS` record type**, so a subtree
> cannot be delegated. DNS therefore stays at Hover using **CNAME records + manual
> ACM DNS validation**. The hybrid API exposure and the nested naming convention
> are unchanged; the DNS plumbing, stack count, and cost details below are revised
> to match.

## Context

The app needs a production deployment on a custom domain. The owner holds
`whoiskevinrich.com` at the registrar **Hover** and wants the app at
`bookshelf.whoiskevinrich.com`, hosted on AWS in the existing separate prod
account (`docs/runbooks/cicd-setup.md`).

Today everything runs on AWS-generated hostnames: the SPA on `*.cloudfront.net`
and the API on `*.execute-api.us-west-2.amazonaws.com`. Two questions had to be
answered: **how DNS is managed** for the subdomain, and **how the browser and the
future MCP server reach the API**.

Three facts constrain the design:

1. **CloudFront ACM certificates must be in `us-east-1`.** The app's stacks deploy
   in `us-west-2` (`AWS_REGION=us-west-2`), so the CloudFront cert is necessarily
   cross-region.
2. **The domain is at Hover, and Hover's DNS editor has no `NS` record type.** A
   subtree cannot be delegated to Route53, so DNS stays at Hover. ACM certs are
   validated by CNAME records added manually at Hover, and the public hostnames are
   CNAMEs → the CloudFront / API custom-domain names. (Hover is also actively used
   for apex/`www`/`presentation`/`home` HTTP forwards, which a full nameserver move
   to Route53 would break — Route53 has no HTTP forwarding.)
3. **ADR-001 makes the API and MCP server the primary deliverables**; the web UI
   is a secondary, interchangeable consumer. The API must remain a first-class,
   standalone service with a clean canonical URL — not something reachable only as
   an appendage of the web front end.

### Options — DNS

| Option | Mechanics | Trade-off |
| --- | --- | --- |
| Subdomain delegation *(initial choice — not possible)* | Route53 zone for *only* `bookshelf.whoiskevinrich.com`; NS records at Hover delegate it. | Would give full CDK automation — **but Hover's DNS editor has no `NS` type, so it can't be created.** |
| Full apex delegation | Move all of `whoiskevinrich.com` DNS to Route53; change nameservers at Hover. | Most automatable, but AWS owns apex + MX, and **breaks Hover's existing apex/`www`/`presentation`/`home` forwards** (Route53 has no HTTP forwarding). |
| **Keep DNS at Hover, CNAME (chosen)** | No Route53. Manual ACM-validation CNAME + `bookshelf` / `api.bookshelf` CNAMEs at Hover. | Apex, email, and existing forwards untouched; ~$0 (no hosted zone). Cost: more manual DNS, and cert deploys block until the validation CNAME is added. |

### Options — API exposure

| Option | Browser path | MCP / programmatic path | Notes |
| --- | --- | --- | --- |
| A — CloudFront `/api` only | same-origin, no CORS | no clean URL: `/api` prefix + path-rewrite, or raw execute-api URL | CORS benefit is browser-only; leaves the API without a canonical hostname. |
| B — `api.` subdomain only | CORS to a known origin | clean `/v1/...` | Single hostname; browser keeps CORS. |
| **Hybrid (chosen)** | CloudFront `/api/*`, same-origin, no CORS | `api.bookshelf.whoiskevinrich.com`, clean `/v1/...` | Two doors to one Lambda. Best of both; ≈ $0 extra. |

Cost is negligible either way. With DNS at Hover there is **no Route53 hosted zone**
(not even the $0.50/month it would cost); both ACM certs are free, and API traffic
through CloudFront falls within the always-free 1 TB / 10M-request tier. The
decision is made on architecture and on what Hover supports, not cost.

## Decision

**DNS:** stays at Hover (no Route53). The ACM certs use manual DNS validation — a
CNAME added at Hover — and the public hostnames are CNAMEs pointing at the
CloudFront distribution (`bookshelf.whoiskevinrich.com`) and the API Gateway
custom-domain regional name (`api.bookshelf.whoiskevinrich.com`). The apex, email,
and existing Hover forwards are left untouched.

**API exposure:** the **hybrid** model. One Hono Lambda behind one API Gateway
HTTP API, exposed through two doors:

- **Browser door** — `bookshelf.whoiskevinrich.com/api/*` served by CloudFront as
  an additional behavior. A CloudFront Function strips the `/api` prefix so Hono's
  existing `/v1/...` routes match unchanged. Same-origin ⇒ **CORS is removed
  entirely**, resolving the `// tightened to CloudFront domain` TODO in
  `api-stack.ts`.
- **API door** — `api.bookshelf.whoiskevinrich.com`, an API Gateway custom domain
  with a regional cert, exposing clean `/v1/...` paths for the MCP server and any
  programmatic client.

**TLS / stacks:** four CDK stacks (`BookshelfCdnCert`, `BookshelfAuth`,
`BookshelfApi`, `BookshelfWeb`). The CloudFront cert lives in its own `us-east-1`
stack (`BookshelfCdnCert`) and is referenced cross-region by the `us-west-2`
`WebStack`; the API's regional cert lives in `ApiStack` (us-west-2). Both certs use
manual DNS validation, so `cdk deploy` of a cert blocks until the validation CNAME
is added at Hover. See `docs/specs/prod-deployment-domain.md` for the construct-level
design and `docs/runbooks/prod-domain-setup.md` for the operational bootstrap.

The MCP server's **auth model** (user-delegated JWT vs. a Cognito machine
`client_credentials` flow) is explicitly out of scope for this ADR and is a
prerequisite for `apps/mcp`; it will get its own ADR alongside the MCP spec. The
hybrid's API door is what makes that future work clean.

### DNS naming convention (personal multi-app domain)

`whoiskevinrich.com` is a personal domain expected to host multiple projects over
time, so we fix a namespace convention now to keep hostnames, certs, and account
boundaries consistent:

> **Each app owns a subtree — `<app>.whoiskevinrich.com`. Services nest inside it —
> `<service>.<app>.whoiskevinrich.com`.**

Concretely: `bookshelf.whoiskevinrich.com` (app) + `api.bookshelf.whoiskevinrich.com`
(API), and a future remote MCP server would be `mcp.bookshelf.whoiskevinrich.com`.
A future project `foo` becomes its own subtree `foo.whoiskevinrich.com` with
`api.foo.whoiskevinrich.com`, deployed to its own AWS account.

With DNS at Hover (CNAMEs, not delegation), this is **why
`api.bookshelf.whoiskevinrich.com` is chosen over a flat
`bookshelf-api.whoiskevinrich.com`**: a single per-subtree wildcard cert
`*.bookshelf.whoiskevinrich.com` covers every nested host (`api.`, future `www.`,
`mcp.`) with **one** cert and **one** manual validation CNAME — whereas a flat
sibling (`bookshelf-api.…`) falls outside that wildcard and would need its own cert
and its own validation record. Nesting keeps both the namespace and the manual-DNS
burden minimal.

Corollaries:

- **One subtree per app, mapped 1:1 to that app's AWS account.** No cross-account
  sharing; each app's CNAMEs + certs live with that app.
- **No shared `api.whoiskevinrich.com`.** A single apex API fronting multiple apps'
  routes is an anti-pattern (coupled deploys, shared blast radius, blurred auth).
  Each app gets its own API hostname under its own subtree.
- **Per-subtree wildcard certs.** Issue `*.bookshelf.whoiskevinrich.com` (with the
  subtree apex as an explicit SAN). One cert per region (CloudFront cert in
  `us-east-1`, API cert in `us-west-2`), each validated by a single CNAME at Hover.
  Because both certs validate the same wildcard in the same account, ACM typically
  emits **one shared validation CNAME** — so the entire subtree's TLS is unblocked
  by adding a single record. Adding `www.`/`admin.`/`mcp.` later needs no new cert.
- **Apex + forwards stay at Hover.** `whoiskevinrich.com` / `www.` and the existing
  HTTP forwards remain at Hover untouched; reaching an app from the apex is a
  deliberate later add (a Hover redirect) and never requires touching the apex.

## Consequences

- The SPA is served at `https://bookshelf.whoiskevinrich.com`; the API has a
  stable canonical home at `https://api.bookshelf.whoiskevinrich.com`.
- The browser makes same-origin calls under `/api/*` with **no CORS**; the
  `corsPreflight` block is removed from `ApiStack`. If a browser-based client ever
  needs the `api.` subdomain directly, CORS must be re-added scoped to the web
  origin.
- `VITE_API_BASE_URL` becomes the relative path `/api`; the web build no longer
  bakes the execute-api URL.
- The MCP server (Phase 3) gets a clean base URL with no `/api` prefix and no CDN
  hop, preserving ADR-001's standalone-API property.
- The first prod deployment is a **manual bootstrap**: deploy the cert stacks (the
  deploy blocks until the ACM validation CNAME is added at Hover), then add the
  `bookshelf` + `api.bookshelf` CNAMEs from the stack outputs. Subsequent deploys
  are `cdk deploy --all -c env=prod` (environment selection per ADR-009), running
  hands-off because the certs are issued and the CNAMEs persist.
- **DNS is more manual than delegation would have been:** each new host (incl. a
  future `mcp.`) is a CNAME added at Hover, and each new cert needs a manual
  validation CNAME — the per-subtree wildcard keeps the latter to one record.
- Apex `whoiskevinrich.com` does **not** reach the app, and Hover's existing
  forwards + email are untouched; reaching the app from the apex is a later add (a
  Hover redirect).
- Cost impact is ≈ $0/month — no Route53 hosted zone; certs, the CloudFront
  Function, and the API custom domain add no meaningful cost.
- One `us-east-1` cert stack plus a single cross-region cert reference — less CDK
  surface than delegation would have needed (no hosted-zone stack, no alias records).
