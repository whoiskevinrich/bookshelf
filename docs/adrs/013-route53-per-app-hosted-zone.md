# ADR-013: Route53 Hosted Zone per App with CDK-Automated Cert Validation

**Status**: Accepted  
**Date**: 2026-06-06  
**Depends on**: ADR-012 — Cloudflare as Authoritative Nameserver (provides NS record support for delegation)

---

## Context

ADR-012 established Cloudflare as the authoritative nameserver for `whoiskevinrich.com`
and noted that NS record support unlocks subdomain delegation to Route53. This ADR
implements that Phase 2.

Today (Phase 1), both ACM certs use `CertificateValidation.fromDns()` with no hosted
zone: `cdk deploy` blocks in `CREATE_IN_PROGRESS` until the validation CNAME is manually
added at Cloudflare. This is the last remaining manual step in the production deployment
path, and the primary source of friction.

With a Route53 hosted zone in scope, CDK can write the validation CNAME automatically
using `CertificateValidation.fromDns(zone)`, and can also manage the public DNS records
(CloudFront alias, API Gateway alias) that currently require manual CNAME entries.

---

## Decision

Add a `DnsStack` (CDK stack, `us-east-1`) that creates a `route53.PublicHostedZone` for
`bookshelf.whoiskevinrich.com` and outputs the four NS values needed for the one-time
Cloudflare delegation step.

Thread the hosted zone through the stack hierarchy:

- **`CdnCertStack`** (`us-east-1`): accepts the zone as a direct prop (same-region
  cross-stack reference); switches to `CertificateValidation.fromDns(zone)`.
- **`ApiStack`** (`us-west-2`): accepts `hostedZoneName` as a plain string in
  `ApiCustomDomainConfig`; calls `HostedZone.fromLookup` at synth time (Route53 is a
  global API — no regional affinity); switches the regional API cert to
  `CertificateValidation.fromDns(zone)`; adds an A-alias record for
  `api.bookshelf.whoiskevinrich.com` → API Gateway regional domain.
- **`WebStack`** (`us-west-2`): accepts `hostedZoneName` as a plain string in
  `WebCustomDomainConfig`; same `fromLookup` pattern; adds an A-alias record for
  `bookshelf.whoiskevinrich.com` → CloudFront distribution.

`DnsStack` only exists when `config.domain` is set (prod only — dev and prod-interim
remain domainless and are unaffected by these changes).

### Cross-region strategy

`DnsStack` and `CdnCertStack` are both in `us-east-1`. The hosted zone object is passed
directly between them — a same-region cross-stack reference, no special machinery.

`ApiStack` and `WebStack` (`us-west-2`) receive `hostedZoneName` as a plain string (no
CDK token, no cross-region reference). They call `HostedZone.fromLookup` independently
during `cdk synth`. Route53 is a global service; lookups succeed from any region. The
result (zone ID) is cached in `cdk.context.json` and committed to source control.

### Deploy sequence (one-time bootstrap per environment)

1. `cdk deploy BookshelfDns -c env=prod` — creates the hosted zone; stack output shows
   four NS values.
2. In Cloudflare → DNS → add one NS record: `bookshelf.whoiskevinrich.com` → those four
   NS values (gray-cloud, not proxied).
3. Wait for propagation (~15 min to 2 hours; verify with `Resolve-DnsName`).
4. `cdk deploy --all -c env=prod` — `fromLookup` finds the zone, caches its ID, cert
   validation and alias records are created automatically. No manual DNS steps.

After the bootstrap, every future `cdk deploy --all -c env=prod` is fully hands-free.
The `cdk.context.json` cache means `cdk synth` no longer queries Route53 on each run.

### `fromLookup` bootstrap requirement

`HostedZone.fromLookup` queries Route53 at **synth time** — if the zone does not yet
exist, the synth fails. The consequence is: `cdk deploy --all` cannot be the very first
command; `BookshelfDns` must be deployed first. This is a one-time constraint, not an
ongoing one.

`api.addDependency(dns)` and `web.addDependency(dns)` are set in `bookshelf.ts` so that
`cdk deploy --all` deploys `BookshelfDns` before the other stacks — but only after the
initial synth has successfully resolved the lookup.

---

## Consequences

### Immediate

- `cdk deploy -c env=prod` no longer blocks waiting for a manually-added validation
  CNAME. The deploy runs to completion unattended.
- The CloudFront and API Gateway CNAME entries previously added manually at Cloudflare
  are replaced by Route53 A-alias records managed by CDK. Only the NS delegation record
  for `bookshelf.whoiskevinrich.com` remains at Cloudflare.

### Ongoing

- All DNS records under `bookshelf.whoiskevinrich.com` are in CDK source control.
  Adding `mcp.bookshelf.whoiskevinrich.com` is a new `route53.CnameRecord` construct —
  no Cloudflare interaction needed.
- A-alias records (CloudFront, API Gateway) are preferred over CNAMEs: no TTL charge,
  automatic IP rotation, faster resolution through Route53's Anycast network.
- `cdk.context.json` gains cached zone lookups. **This file must be committed to source
  control** so CI/CD synths consistently without re-querying Route53.
- Route53 hosted zone cost: $0.50/month (≈ $6/year) for the prod zone.

### Cross-account

Each future app follows the same pattern in its own AWS account. No cross-account DNS
access is required — Cloudflare delegates to each account's Route53 nameservers
independently. See ADR-012 §Two-Tier Long-Term Architecture.

### What does NOT change

- CDK stack names, S3 bucket, DynamoDB table, CloudFront distribution — in-place update.
- `prod-interim` and `dev` environments — completely unaffected (no domain, no zone).
- Hover as registrar, Cloudflare as apex nameserver — unchanged.
- The per-subtree wildcard cert strategy (`*.bookshelf.whoiskevinrich.com`) — unchanged.

---

## See Also

- [ADR-012: Cloudflare as Authoritative Nameserver](012-cloudflare-nameservers.md) — prerequisite
- [ADR-008: Production Custom Domain & Hybrid API Exposure](008-production-custom-domain.md) — original architecture (API/web hybrid unchanged)
- [docs/specs/cloudflare-dns-migration.md](../specs/cloudflare-dns-migration.md) — migration runbook (Phase 1 + Phase 2)
- [dns-app-subdomain skill](~/.claude/skills/dns-app-subdomain/) — reusable template for future apps
