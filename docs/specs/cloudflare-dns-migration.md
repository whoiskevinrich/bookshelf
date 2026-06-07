# Spec: Cloudflare DNS Migration

**Status**: Approved  
**Date**: 2026-06-06  
**ADR**: [docs/adrs/012-cloudflare-nameservers.md](../adrs/012-cloudflare-nameservers.md)

---

## Problem Statement

Hover's authoritative nameserver returns `SERVFAIL` for ACM DNS-validation CNAMEs (underscore-prefixed records), preventing TLS cert issuance for `bookshelf.whoiskevinrich.com`. The production custom domain — designed in ADR-008 and deployed via CDK — cannot be activated. The app is live on `*.cloudfront.net` (prod-interim, ADR-010) but stuck there until the cert validates. A Hover support ticket is open with no timeline. Moving DNS management to Cloudflare while keeping Hover as the registrar resolves the SERVFAIL issue and removes all the DNS platform gaps that constrained ADR-008.

---

## Goals

1. **Unblock ACM cert validation** for `bookshelf.whoiskevinrich.com` and `*.bookshelf.whoiskevinrich.com` so the CDK deploy with `-c env=prod` can complete.
2. **Preserve all existing Hover forwards** — apex (`whoiskevinrich.com`), `www`, `presentation`, and `home` HTTP redirect behavior must be intact after cutover.
3. **Zero-downtime migration** — all existing CNAME records must be live at Cloudflare before nameserver cutover; no DNS gap for existing records.
4. **Establish Cloudflare as the authoritative DNS platform** for the domain going forward; Hover is registrar-only.
5. **Enable the prod custom domain flip** within one session after NS propagation completes.

---

## Non-Goals

- **Changing the domain registrar.** Hover remains the registrar; only the nameservers change.
- **Changing the API/web architecture.** The hybrid model from ADR-008 (CNAME → CloudFront, CNAME → API Gateway) is unchanged.
- **Enabling Cloudflare proxy mode for the bookshelf subdomain.** Records pointing to CloudFront or API Gateway must stay DNS-only (gray-cloud) to avoid double-CDN behavior and routing conflicts.
- **Cloudflare edge compute.** No Workers, R2, or other Cloudflare products are in scope.
- **DNS automation via Cloudflare API.** Records are created manually for now; API automation is a future option.
- **DNSSEC.** Out of scope for this migration; revisit separately if needed.

---

## User Stories

**Developer**

- As the developer, I want the ACM cert for `bookshelf.whoiskevinrich.com` to validate so that I can run `cdk deploy -c env=prod` and activate the production custom domain.
- As the developer, I want DNS propagation visible across the public internet so that I can confirm cutover is complete before declaring the migration done.
- As the developer, I want all future DNS record changes to be made at Cloudflare so that I am no longer subject to Hover's DNS platform limitations.

**Visitor**

- As a visitor to `whoiskevinrich.com` or `www.whoiskevinrich.com`, I want the existing HTTP redirect behavior to continue working after the migration so that I land on the right page without noticing a change.
- As a visitor, I want TLS to remain valid throughout the migration so that there is no browser certificate error at any point.

---

## Requirements

### Must-Have (P0)

| #   | Requirement                                                                    | Acceptance Criteria                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Cloudflare zone created** for `whoiskevinrich.com` on the free plan          | Zone shows "Active" in the Cloudflare dashboard after NS propagation                                                                                                                 |
| 2   | **All existing DNS records recreated at Cloudflare** before nameserver cutover | `nslookup` / `dig` against Cloudflare's NS returns the same results as Hover's NS for all records                                                                                    |
| 3   | **Hover HTTP forwards recreated as Cloudflare Redirect Rules**                 | GET to `http://whoiskevinrich.com`, `http://www.whoiskevinrich.com`, `presentation.whoiskevinrich.com`, and `home.whoiskevinrich.com` each return the expected 301/302 after cutover |
| 4   | **ACM validation CNAME added at Cloudflare** (DNS-only, gray-cloud)            | Record is visible in Cloudflare DNS; ACM shows ISSUED in AWS Console after NS propagation                                                                                            |
| 5   | **Nameservers updated at Hover** to the two Cloudflare-assigned NS values      | `dig NS whoiskevinrich.com @8.8.8.8` returns Cloudflare nameservers once propagation completes                                                                                       |
| 6   | **ACM cert validates**                                                         | `aws acm describe-certificate --certificate-arn <arn> --query 'Certificate.Status'` returns `"ISSUED"`                                                                               |
| 7   | **Production custom domain deploys**                                           | `cdk deploy --all -c env=prod` completes without error; `https://bookshelf.whoiskevinrich.com` serves the app                                                                        |

### Nice-to-Have (P1)

| #   | Requirement                                                         | Notes                                                                                                     |
| --- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1   | **Cloudflare zone ID and NS pair documented** in a reference memory | Makes future DNS changes discoverable without logging in to Cloudflare each time                          |
| 2   | **Cloudflare proxy considered** for the apex A record               | Provides DDoS scrubbing for the personal domain root at no cost; evaluate vs. naked-domain CNAME behavior |

### Future Considerations (P2)

| #   | Idea                                                   | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Cloudflare API access**                              | Enables Terraform or a CDK Custom Resource to manage DNS records as code; unblocks full automation of cert validation                                                                                                                                                                                                                                                                                                                                                                                           |
| 2   | **Two-tier architecture: Route53 hosted zone per app** | Cloudflare holds one NS delegation record per app; each app's CDK stack manages its own Route53 zone, automating cert validation (`CertificateValidation.fromDns`) and all DNS records. Cross-account safe — each zone lives in its app's own AWS account. One-time bootstrap: `cdk deploy DnsStack` → capture 4 NS values → add one NS record at Cloudflare. All future deploys are hands-free. Template in the `dns-app-subdomain` skill (`~/.claude/skills/`). See ADR-012 §Two-Tier Long-Term Architecture. |

---

## Migration Runbook

### Pre-cutover (while Hover NS is still active)

1. **Create a Cloudflare account** (free plan) at `cloudflare.com` if one does not exist.

2. **Add the zone.** In Cloudflare → Add a Site → enter `whoiskevinrich.com` → select Free plan. Cloudflare will scan and auto-import existing DNS records.

3. **Audit auto-imported records.** Compare Cloudflare's import against all records visible in Hover's DNS editor:
   - Verify each CNAME is present and points to the correct value (DNS-only / gray-cloud — **not** proxied)
   - Verify any MX records if email is in use
   - Note any records Cloudflare did not import

4. **Recreate Hover HTTP forwards as Cloudflare Redirect Rules.**  
   In Cloudflare → Rules → Redirect Rules → Create Rule for each forward:
   - `whoiskevinrich.com` → `<destination>` (301)
   - `www.whoiskevinrich.com` → `<destination>` (301)
   - `presentation.whoiskevinrich.com` → `<destination>` (301)
   - `home.whoiskevinrich.com` → `<destination>` (301)

   Hover forwards are HTTP-level redirects; Cloudflare Redirect Rules are the direct equivalent. The apex redirect requires an A record (or AAAA) pointing at Cloudflare's proxy — use Cloudflare's `0.0.0.0` placeholder pattern for proxied apex if no real IP is needed.

5. **Verify all records against Cloudflare's NS before cutting over.**  
   Use `dig @<cloudflare-ns1> <record> <type>` to confirm results before changing the live NS at Hover.

### ACM cert preparation

6. **Get the ACM validation CNAME value.** If the CDK cert stacks have been attempted before and the CNAME value is already known (from AWS Console or a prior deploy output), use it. Otherwise, deploy only `BookshelfCdnCert` in dry-run / describe mode to get the CNAME:

   ```powershell
   aws acm describe-certificate `
     --certificate-arn <arn> `
     --region us-east-1 `
     --query "Certificate.DomainValidationOptions[*].{Name:ResourceRecord.Name,Value:ResourceRecord.Value}" `
     --output table
   ```

7. **Add the ACM validation CNAME at Cloudflare** (DNS-only, gray-cloud). The record name includes a leading underscore; Cloudflare handles this correctly unlike Hover.

### Nameserver cutover

8. **Copy the two Cloudflare-assigned NS values** from the Cloudflare dashboard (e.g. `ada.ns.cloudflare.com`, `bob.ns.cloudflare.com` — values are zone-specific).

9. **Update nameservers at Hover.**  
   Hover → Domains → `whoiskevinrich.com` → Edit Nameservers → replace Hover's NS pair with the Cloudflare pair.

10. **Wait for NS propagation** — typically 15 min to 2 hours; up to 24 hours for full global propagation. Monitor with:
    ```powershell
    Resolve-DnsName -Name whoiskevinrich.com -Type NS
    ```
    or `dig NS whoiskevinrich.com @8.8.8.8`.

### Post-cutover verification

11. **Confirm Cloudflare is authoritative:**
    - `dig NS whoiskevinrich.com @8.8.8.8` returns Cloudflare nameservers
    - Cloudflare dashboard shows zone status "Active"

12. **Confirm existing forwards work:**
    - `curl -I http://whoiskevinrich.com` → 301/302 to expected destination
    - Repeat for `www`, `presentation`, `home`

13. **Confirm ACM cert validates:**
    - AWS Console → ACM → cert for `bookshelf.whoiskevinrich.com` → status becomes `Issued`
    - May take a few minutes after NS propagation for AWS to recheck

14. **Deploy prod:**
    ```powershell
    cdk deploy --all -c env=prod
    ```
    The cert stacks will no longer block; the custom domain goes live.

---

## Success Metrics

| Metric                                  | Target                                                     |
| --------------------------------------- | ---------------------------------------------------------- |
| ACM cert status                         | `ISSUED` within 30 min of NS propagation                   |
| All Hover forwards                      | HTTP 30x behavior unchanged (verified manually)            |
| `bookshelf.whoiskevinrich.com` resolves | A/CNAME returns CloudFront IP within 2 hours of cutover    |
| `cdk deploy -c env=prod`                | Completes without error in first attempt after cert issues |
| DNS downtime                            | Zero — all records live at Cloudflare before NS cutover    |

---

## Open Questions

| #   | Question                                                             | Owner                                                                                                               | Blocking?                            |
| --- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| 1   | ~~What are the exact destination URLs for the four Hover forwards?~~ | **Resolved**: destination URLs are not mission-critical; fill them in at the Cloudflare UI during migration         | No                                   |
| 2   | ~~Is email or MX in active use for `whoiskevinrich.com`?~~           | **Resolved**: yes, but not mission-critical; Cloudflare's auto-scan imports MX records — verify before cutting over | No                                   |
| 3   | Should DNSSEC be enabled at Cloudflare now, or deferred?             | Developer                                                                                                           | No — out of scope for this migration |

---

## Timeline Considerations

- **No hard deadline** — blocked on Hover ticket; this migration unblocks it at will.
- **Migration can be done in a single session**: pre-cutover record setup (~30 min) + NS change + propagation wait (~1–2 hours) + verification + prod deploy.
- **No CDK code changes required** — the architecture (ADR-008) is unchanged; only DNS records change.
