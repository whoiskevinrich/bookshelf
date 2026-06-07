# Runbook: Production Custom Domain Setup

One-time bootstrap to put the production app on `bookshelf.whoiskevinrich.com`
(SPA) and `api.bookshelf.whoiskevinrich.com` (API). Implements ADR-008; design in
`docs/specs/prod-deployment-domain.md`.

The domain `whoiskevinrich.com` is registered at **Hover**, and **DNS stays at
Hover** — `ns1/ns2.hover.com` are left untouched, so the existing apex/`www`/
`presentation`/`home` forwards and any email keep working. Hover's DNS editor has
no `NS` record type, so we cannot delegate a subtree to Route53; instead we use
**CNAME records at Hover** plus **manual ACM DNS validation** (ADR-008).

> **What's manual here:** ACM proves domain ownership with a DNS record. With no
> Route53 zone, CDK can't create it for you — so `cdk deploy` of a cert **blocks**
> in `CREATE_IN_PROGRESS` until you add the validation CNAME at Hover, then
> completes. The record persists; ACM reuses it for auto-renewal.

## Prerequisites

- Prod AWS account bootstrapped for CDK in **both** `us-west-2` and `us-east-1`
  (`cdk bootstrap aws://PROD_ACCOUNT_ID/us-west-2` and `.../us-east-1`). The
  `us-east-1` bootstrap is required for the CloudFront cert stack.
- **The environment is selected with `-c env=prod`** (ADR-009). That one flag
  applies the whole prod topology atomically — custom domains + self-signup.
  `deploy.yml` (dev) uses `env=dev`; `promote.yml` (prod) uses `env=prod`.
- Prod GitHub Actions variables set (`docs/runbooks/cicd-setup.md` §3): `AWS_REGION`,
  `AWS_ROLE_ARN`, `AWS_ACCOUNT` for the `prod` environment.
- Active prod AWS credentials locally, plus console/CLI access to **ACM** in both
  `us-east-1` and `us-west-2` to read the validation records.
- Login to Hover with access to the `whoiskevinrich.com` **DNS records** panel.
  Do **not** touch the NAMESERVERS section.

---

## Phase 1 — Issue the certificates (manual DNS validation)

Both certs cover `*.bookshelf.whoiskevinrich.com` (the CloudFront cert also covers
the apex `bookshelf.whoiskevinrich.com`). Thanks to the wildcard, ACM typically
emits a **single** validation CNAME — `_<hash>.bookshelf.whoiskevinrich.com` — that
satisfies **both** certs (same record, same AWS account). You add it once.

**1. Start the CloudFront cert deploy — it will block on validation:**

```bash
# with prod credentials active
cd packages/infra
npx cdk deploy BookshelfCdnCert -c env=prod
# ← stays in CREATE_IN_PROGRESS; leave it running, open a second terminal
```

**2. Read the required validation record** (second terminal, or the ACM console
in `us-east-1`):

```bash
ARN=$(aws acm list-certificates --region us-east-1 \
  --query "CertificateSummaryList[?DomainName=='bookshelf.whoiskevinrich.com'].CertificateArn" \
  --output text)
aws acm describe-certificate --region us-east-1 --certificate-arn "$ARN" \
  --query "Certificate.DomainValidationOptions[].ResourceRecord" --output table
```

You'll get a `Name` (e.g. `_a1b2c3.bookshelf.whoiskevinrich.com.`) and a `Value`
(e.g. `_x9y8z7.acm-validations.aws.`).

**3. Add it at Hover** → DNS records → Create DNS Record:

| Field       | Value                                                                 |
| ----------- | --------------------------------------------------------------------- |
| TYPE        | `CNAME`                                                               |
| HOSTNAME    | the Name **minus the domain** — e.g. `_a1b2c3.bookshelf` (Hover appends `.whoiskevinrich.com`) |
| TARGET NAME | the full ACM Value — e.g. `_x9y8z7.acm-validations.aws.`              |
| TTL         | Default                                                              |

> The single most common mistake: pasting the **full** `_a1b2c3.bookshelf.whoiskevinrich.com`
> into HOSTNAME. Hover appends the apex, so that becomes
> `_a1b2c3.bookshelf.whoiskevinrich.com.whoiskevinrich.com` and never validates.
> Enter only `_a1b2c3.bookshelf`.

**4. ACM validates within a few minutes** → the blocked `cdk deploy BookshelfCdnCert`
completes. If it hasn't after ~15 min, re-check the Hover record (host, value, no
typos).

**5. Deploy Auth + API.** The API's regional cert (`us-west-2`) validates against
the **same** CNAME you already added, so this is fast; the API custom domain and
mapping are created here:

```bash
npx cdk deploy BookshelfAuth BookshelfApi -c env=prod -c version=vX.Y.Z
```

> If the API cert happens to request a *different* validation record (rare with the
> shared wildcard), read it from the **`us-west-2`** ACM console and add that CNAME
> at Hover too, the same way.

---

## Phase 2 — Build + deploy web, then point the hostnames

**1. Build the web bundle and deploy the web stack** (uses the now-issued
CloudFront cert). Build with the prod values first, exactly as `promote.yml` does:
`VITE_API_BASE_URL=/api` (same-origin via CloudFront) and the Cognito IDs from the
`BookshelfAuth` outputs.

```bash
npx cdk deploy BookshelfWeb -c env=prod -c version=vX.Y.Z
```

**2. Read the CNAME targets** from the stack outputs:

```bash
aws cloudformation describe-stacks --stack-name BookshelfWeb --region us-west-2 \
  --query "Stacks[0].Outputs[?OutputKey=='WebCnameTargetOutput'].OutputValue" --output text
#   → e.g. d1a2b3c4d5e6f7.cloudfront.net

aws cloudformation describe-stacks --stack-name BookshelfApi --region us-west-2 \
  --query "Stacks[0].Outputs[?OutputKey=='ApiCnameTargetOutput'].OutputValue" --output text
#   → e.g. d-a1b2c3d4e5.execute-api.us-west-2.amazonaws.com
```

**3. Add the two host CNAMEs at Hover** (leave apex/`www`/`presentation`/`home`
forwards untouched):

| HOSTNAME        | TYPE  | TARGET NAME                                         |
| --------------- | ----- | --------------------------------------------------- |
| `bookshelf`     | CNAME | the CloudFront domain (`d…​.cloudfront.net`)        |
| `api.bookshelf` | CNAME | the API regional domain (`d-…​.execute-api.…​`)     |

---

## Phase 3 — Verify

Once the CNAMEs propagate (usually minutes):

```bash
# SPA over HTTPS on the custom domain
curl -sI https://bookshelf.whoiskevinrich.com | head -n1          # 200

# API door (canonical, used by MCP)
curl -s  https://api.bookshelf.whoiskevinrich.com/health           # {"status":"ok"}

# Browser door (same-origin /api, CloudFront strips the prefix)
curl -s  https://bookshelf.whoiskevinrich.com/api/health           # {"status":"ok"}

# HTTP redirects to HTTPS
curl -sI http://bookshelf.whoiskevinrich.com | grep -i location    # https://...
```

Then confirm in a browser: the SPA loads, sign-up/login works against the prod
Cognito pool, and the shelf page makes successful same-origin `/api/v1/shelf`
calls (network tab — no CORS preflight, no CORS errors).

---

## Steady state

After this one-time bootstrap, `promote.yml` runs hands-off: the certs are issued
(the validation CNAME persists and auto-renews), the host CNAMEs exist, and
`cdk deploy --all -c env=prod` treats the cert/domain resources as no-ops.

---

## Rollback / teardown notes

- **Web content** rolls back via the existing versioned-prefix mechanism
  (`docs/runbooks/rollback.md`) — unaffected by the domain layer.
- **Never delete the ACM validation CNAME at Hover** — ACM re-checks it on
  renewal; removing it can cause the cert to fail to renew.
- Destroying `BookshelfCdnCert` / the API cert means re-doing Phase 1 validation.

---

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `cdk deploy BookshelfCdnCert` / `BookshelfApi` blocks indefinitely | The ACM validation CNAME isn't resolving — verify the Hover record. Host must be `_<hash>.bookshelf` (not the full FQDN), value must match ACM exactly. Check with `dig +short _<hash>.bookshelf.whoiskevinrich.com CNAME`. |
| `cdk deploy` errors `…no credentials configured` for `us-east-1` | `us-east-1` not bootstrapped — run `cdk bootstrap aws://PROD_ACCOUNT_ID/us-east-1`. |
| `https://bookshelf.whoiskevinrich.com` doesn't resolve | The `bookshelf` CNAME isn't added/propagated yet, or points at the wrong target — re-check `WebCnameTargetOutput`. |
| Browser shows a CORS error calling `/api/...` | Web was built with an absolute API URL — rebuild with `VITE_API_BASE_URL=/api`. |
| `api.bookshelf...` returns 404 for `/v1/...` | API custom domain mapping missing, or the `api.bookshelf` CNAME points at the execute-api URL instead of the **custom domain** regional name (`ApiCnameTargetOutput`). |
| `bookshelf.../api/v1/...` 404 but `api.bookshelf.../v1/...` works | CloudFront path-strip Function not associated / not stripping `/api`. |
| TLS warning on the custom domain | Cert not issued yet (still validating), or CloudFront/API still deploying. |
