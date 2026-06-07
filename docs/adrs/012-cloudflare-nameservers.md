# ADR-012: Cloudflare as Authoritative Nameserver for whoiskevinrich.com

**Status**: Accepted  
**Date**: 2026-06-06  
**Supersedes (DNS portion)**: ADR-008 — Production Custom Domain & Hybrid API Exposure

---

## Context

ADR-008 chose to keep DNS at Hover because two constraints made Route53 delegation
impractical: Hover's DNS editor has no `NS` record type (making subdomain delegation
impossible), and Route53 has no HTTP forwarding (which would have broken the apex,
`www`, `presentation`, and `home` redirects that Hover provides for
`whoiskevinrich.com`).

That decision held until ADR-010, which documents an operational failure: Hover's
authoritative nameserver returns `SERVFAIL` for the ACM DNS-validation CNAME required
to issue the TLS cert for `bookshelf.whoiskevinrich.com`. The record is correctly
entered, DNSSEC is off, and the rest of the zone is healthy — only the
underscore-prefixed validation record fails. A Hover support ticket is open with no
timeline for resolution. The production custom domain cannot be activated until the
cert validates.

The key observation is that the original DNS decision was shaped by _two specific
Hover limitations_ and one AWS limitation:

1. **Hover has no `NS` record type** → subdomain delegation to Route53 is impossible.
2. **Route53 has no HTTP forwarding** → full apex delegation to Route53 would break
   all existing Hover forwards.
3. **Hover's DNS infrastructure is not robust enough for underscore-prefixed records.**

Cloudflare eliminates all three constraints: it fully supports NS records, it has
Page Rules and Redirect Rules for HTTP forwarding, and its DNS infrastructure is
globally distributed with strong reliability.

---

## Decision Options

| Option                                          | Mechanism                                                                  | Trade-offs                                                                                                                                                     |
| ----------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A — Wait for Hover to fix SERVFAIL**          | Keep DNS at Hover; block on Hover support                                  | Zero work; timeline is entirely out of our control. Custom domain stays blocked indefinitely.                                                                  |
| **B — ACM email validation fallback**           | Switch cert to email validation (avoids DNS records entirely)              | ACM email validation requires a working MX record; Hover forwards are not a real mail server. Risky and non-standard.                                          |
| **C — Full apex delegation to Route53**         | Change NS at Hover → Route53 hosted zone                                   | Most CDK-automatable. **Breaks existing apex/www/presentation/home HTTP forwards** — Route53 has no forwarding.                                                |
| **D — Move nameservers to Cloudflare (chosen)** | Change NS at Hover → Cloudflare; recreate records + forwards at Cloudflare | Resolves SERVFAIL. Cloudflare Redirect Rules replace Hover forwards. NS records available for future subdomain delegation. Free plan. No architectural change. |

---

## Decision

Move the authoritative nameservers for `whoiskevinrich.com` from Hover to Cloudflare.
Hover remains the registrar; only the NS values change.

**Why Cloudflare over Route53 (Option C):**

Cloudflare is the only option that resolves _all three_ original constraints from
ADR-008:

- Cloudflare has **NS records** — future subdomain delegation to Route53 is now
  possible if CDK automation of DNS validation is ever wanted.
- Cloudflare has **Redirect Rules** — HTTP forwarding replaces Hover's forwards
  without losing the behavior (Route53 has no equivalent).
- Cloudflare's DNS infrastructure **does not exhibit the SERVFAIL bug** — the
  ACM validation CNAME (underscore-prefixed) will be served correctly.

Additionally:

- The **free plan** is sufficient for this use case.
- **Cloudflare proxy** (orange-cloud) is available as an optional upgrade for DDoS
  protection on the personal domain apex, at no cost.
- The **Cloudflare API** enables future Terraform or CDK Custom Resource automation
  of DNS record management.
- Cloudflare's global anycast network gives **faster DNS resolution times** worldwide
  versus Hover's single-region DNS.

**Architecture unchanged:** The API/web hybrid model from ADR-008 is unchanged.
`bookshelf.whoiskevinrich.com` remains a CNAME → CloudFront, and
`api.bookshelf.whoiskevinrich.com` remains a CNAME → API Gateway custom domain. The
per-subtree wildcard cert strategy (`*.bookshelf.whoiskevinrich.com`) is unchanged.
ACM validation remains manual DNS validation (a CNAME added at Cloudflare instead of
at Hover).

**Proxy mode:** CNAME records pointing to CloudFront or API Gateway **must be set to
DNS-only (gray-cloud)**, not proxied. Enabling the Cloudflare proxy in front of
CloudFront would create a double-CDN hop, break CloudFront's own TLS termination
model, and potentially break ACM cert validation. The apex record (if used for
Cloudflare's Redirect Rules) may be proxied (orange-cloud) since it never reaches AWS.

---

## Consequences

### Immediate

- The ACM DNS-validation CNAME can be added at Cloudflare where it will be served
  correctly. Once NS propagation completes, ACM picks it up and the cert issues.
- `cdk deploy --all -c env=prod` can then complete without timing out, and
  `bookshelf.whoiskevinrich.com` goes live.

### Ongoing operational model

- All future DNS record changes are made at **Cloudflare**, not Hover. Hover is the
  registrar only — domain renewal and contact records stay there.
- Adding a new service (e.g. `mcp.bookshelf.whoiskevinrich.com`) means adding a CNAME
  at Cloudflare; no interaction with Hover is needed.
- New per-subtree wildcard cert validation requires one new CNAME at Cloudflare —
  same burden as before, but now reliable.
- The Hover forwards (apex, www, presentation, home) must be recreated as Cloudflare
  Redirect Rules before the nameserver cutover; existing behavior is preserved.

### Two-Tier Long-Term Architecture (Phase 2, future ADR-013)

This ADR is Phase 1: Cloudflare as the authoritative nameserver for the apex zone.
Phase 2 — to be recorded as ADR-013 before the next app is onboarded — adds a
Route53 hosted zone per app, delegated from Cloudflare, making CDK the sole authority
for all DNS changes and cert validation within each app's subdomain.

**Pattern:**

```
whoiskevinrich.com  ← Cloudflare (apex zone, rarely changes)
│
├─ Redirect Rules: apex / www / presentation / home forwards
├─ NS: bookshelf.whoiskevinrich.com  → Route53 (bookshelf prod account, CDK-managed)
│       ├─ CNAME: bookshelf.…        → CloudFront distribution
│       ├─ CNAME: api.bookshelf.…    → API Gateway custom domain
│       └─ CNAME: _acm-validation.…  → (auto-created by CertificateValidation.fromDns)
└─ NS: <future-app>.whoiskevinrich.com → Route53 (<future-app> account, CDK-managed)
```

**Cross-account is not a problem.** Each app's Route53 hosted zone lives in that
app's own AWS account. Cloudflare points to whatever Route53 nameservers that account
was assigned — there is no cross-account DNS access required. A future app in a
completely separate AWS account follows the exact same pattern with zero cross-account
wiring.

**What changes in CDK — cert validation becomes fully automated:**

```typescript
// Phase 1 (this ADR) — manual; cdk deploy blocks until CNAME is added at Cloudflare
new acm.Certificate(this, "Cert", {
  domainName: "*.bookshelf.whoiskevinrich.com",
  validation: acm.CertificateValidation.fromDns(),
});

// Phase 2 — automated; CDK writes the validation CNAME to Route53 automatically
const zone = route53.HostedZone.fromLookup(this, "Zone", {
  domainName: "bookshelf.whoiskevinrich.com",
});
new acm.Certificate(this, "Cert", {
  domainName: "*.bookshelf.whoiskevinrich.com",
  validation: acm.CertificateValidation.fromDns(zone),
});
```

**One-time bootstrap per new app:**

1. `cdk deploy DnsStack` → stack outputs 4 Route53 NS values.
2. In Cloudflare → DNS → add one NS record: `<app>.whoiskevinrich.com` → those 4 NS values.
3. All future `cdk deploy` runs automate cert validation and DNS records. No manual
   DNS changes ever again for that app's subtree.

A reusable skill (`dns-app-subdomain`, in `~/.claude/skills/`) captures this runbook
for future projects.

**Other future options:**

- **Cloudflare API / IaC**: Terraform Cloudflare provider or a CDK Custom Resource
  can automate the one-time NS delegation step — removes the only remaining manual
  action. Worth revisiting once ≥ 2 apps are live.
- **Cloudflare proxy** for the apex (`orange-cloud`) can be enabled at any time for
  DDoS scrubbing; app subdomains remain DNS-only (gray-cloud) regardless.

### Risks

| Risk                                              | Likelihood | Mitigation                                                                                                                                      |
| ------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Hover forwards not fully recreated before cutover | Medium     | Pre-cutover checklist: enumerate all forwards from Hover's DNS editor and verify each as a Cloudflare Redirect Rule before changing NS          |
| Record gap during NS propagation                  | Low        | All records created at Cloudflare before NS change; propagation serves from Cloudflare immediately for resolvers that have picked up the new NS |
| Cloudflare auto-scan misses a record              | Low        | Manually audit Cloudflare's import against Hover's DNS editor before cutover                                                                    |
| CNAME accidentally set to proxied (orange-cloud)  | Low        | Explicitly verify gray-cloud on all CloudFront/API Gateway CNAMEs; CDK stacks validate via custom domain health check                           |

### What does NOT change

- Domain registrar (Hover)
- CDK stacks and deployment process (`cdk deploy --all -c env=prod`)
- ACM cert strategy (manual DNS validation, per-subtree wildcard)
- API/web hybrid model and all hostnames from ADR-008
- Multi-app namespace convention (`<app>.whoiskevinrich.com`)
- Cost profile (Cloudflare free plan; no Route53 hosted zone; AWS costs unchanged)

---

## See Also

- [ADR-008: Production Custom Domain & Hybrid API Exposure](008-production-custom-domain.md) — original DNS decision superseded here for mechanism only
- [ADR-010: Interim Domainless Production Deployment](010-interim-domainless-prod.md) — documents the SERVFAIL blocker this ADR resolves
- [docs/specs/cloudflare-dns-migration.md](../specs/cloudflare-dns-migration.md) — migration runbook with step-by-step cutover procedure
