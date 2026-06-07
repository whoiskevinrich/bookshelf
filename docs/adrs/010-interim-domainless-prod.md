# ADR-010: Interim Domainless Production Deployment

**Status**: Accepted
**Date**: 2026-06-06

## Context

The production custom domain (ADR-008) is blocked by a registrar-side fault:
Hover's authoritative nameserver returns `SERVFAIL` for the ACM DNS-validation
CNAME (a correctly-entered record, in a healthy zone, DNSSEC off — only that one
underscore-prefixed record fails). The cert therefore cannot validate, and because
the API's regional cert lives in `BookshelfApi`, every deploy attempt hangs on
validation, times out, and rolls back — orphaning the `RETAIN` DynamoDB table each
time. A Hover support ticket is open, but the timeline is out of our control.

We want production **live and properly locked down now**, on the AWS-generated
hostnames, and flip the custom domain on later when the registrar is fixed —
without weakening anything except the hostname.

The naive "domainless = dev topology" path is **not** acceptable as prod: dev
leaves API Gateway CORS at `allowOrigins: ["*"]` (the SPA calls the execute-api URL
cross-origin). For a production surface we want that tightened.

## Decision

Add a third environment, **`prod-interim`** (`-c env=prod-interim`), that ships the
full app on `*.cloudfront.net` with the **same security posture as final prod minus
the hostname**:

- **Same-origin API, no CORS.** The CloudFront `/api/*` behavior (and the
  `/api`-strip Function) runs on the default CloudFront domain — the browser calls
  the API same-origin, so **no CORS is configured** (`sameOrigin: true`). This is
  strictly tighter than a scoped allowlist.
- **Invite-only.** `allowSelfSignUp: false` — the app is not openly registerable
  while it sits on a discoverable URL pre-launch.
- **No certs / no custom domain.** `BookshelfCdnCert` and the API custom domain are
  not created, so there is nothing to validate at the registrar — the deploy
  completes cleanly and stops the table-orphaning loop.

To make this possible, the stack props were **decoupled**: `ApiStack.sameOrigin`
(drop CORS) is independent of `ApiStack.customDomain` (the `api.` hostname), and
`WebStack.apiOrigin` (the `/api/*` routing) is independent of
`WebStack.customDomain` (cert + alias). The three environments compose these:

| env | self-signup | API via CloudFront / CORS | custom domain + certs |
| --- | --- | --- | --- |
| `dev` | off | no — cross-origin, CORS `*` | none |
| `prod-interim` | off | yes — same-origin, **no CORS** | none |
| `prod` | on | yes — same-origin, no CORS | `bookshelf.whoiskevinrich.com` |

Security delta vs final prod: **only the hostname** (`*.cloudfront.net` vs
`bookshelf.whoiskevinrich.com`). TLS is valid (AWS-managed cert), authn/authz, IAM,
and data access are identical. See the security analysis in the session notes.

## Consequences

- Production goes live now on the CloudFront URL, locked down (same-origin, no CORS,
  invite-only), with no dependency on the blocked registrar record.
- The interim → final transition is an in-place **update**: `-c env=prod` adds the
  CloudFront cert, the custom `domainNames`/cert on the existing distribution, and
  the `api.` custom domain — no replacement of the table, bucket, or distribution.
  Self-signup flips on at the same time.
- `prod-interim` and `prod` deploy to the **same prod account** (account is ambient,
  ADR-009) and produce the **same stack names** (`BookshelfApi`, `BookshelfWeb`), so
  the flip is a normal stack update, not a new deployment.
- Switching the custom domain on is tracked as a future phase (TASKS.md) and gated
  on the registrar fix (the Hover ticket) or a pivot (email validation / Route53).
- Minor residual: the public book-search proxy is reachable on the CloudFront URL
  pre-launch; it's a public endpoint by design (quota, not data). Revisit with WAF /
  rate limiting if abused.
