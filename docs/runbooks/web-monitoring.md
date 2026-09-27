# Runbook: Web Front-End Monitoring

Prod's web front end served S3 `AccessDenied` on every page from 2026-08-13 to
2026-09-27 and nothing flagged it (BOOKSHELF-109). Three checks now cover the deployed
SPA itself, not just the API (BOOKSHELF-111).

## What runs where

| Check                        | Where                                    | When                                   | On failure                                                   |
| ---------------------------- | ---------------------------------------- | -------------------------------------- | ------------------------------------------------------------ |
| **Web smoke (deploy)**       | `deploy.yml` → dev, `promote.yml` → prod | After the Web stack deploys            | Dev: rolls back with the API smoke. Prod: fails the promote. |
| **Web uptime (prod)**        | `web-uptime.yml`                         | Daily, 15:00 UTC (≈ 08:00 PT) + manual | GitHub emails you (see "Where alerts land")                  |
| **E2E on the deployed site** | `e2e.yml` job `e2e-deployed`             | Nightly + manual (not on push)         | Red run + `playwright-report-deployed` artifact              |

The first two share one script, `scripts/web-smoke.mjs` (tests in
`scripts/web-smoke.test.mjs`, run by `pnpm test`). The E2E job runs the
full Playwright suite.

### What the web smoke checks

- `GET /` and `GET /shelf` → 200 and the HTML contains `<div id="root"`. `/shelf` is a
  client route, so it exercises the SPA 403/404 → `index.html` fallback.
- The entry `<script src>` and `<link rel="stylesheet">` that `/` references → 200 **with
  a JS/CSS content-type**. The fallback serves a missing asset as `200 text/html`, so
  status alone would pass on a blank page.
- `GET /config.json` → 200, valid JSON, and `cognito.userPoolId` is a pool id. The deploy
  workflows also pass `EXPECTED_USER_POOL_ID` from the `BookshelfAuth` output, so a
  stale or wrong config fails too.
- It retries 3 times, 10s apart, to absorb CloudFront invalidation lag right after a
  deploy.

Run it by hand:

```bash
WEB_BASE_URL=https://bookshelf.whoiskevinrich.com node scripts/web-smoke.mjs
```

## Where alerts land

There is no AWS alarm or SNS topic. When a **scheduled** run of `web-uptime.yml` fails,
GitHub emails **the user who last edited the `cron` line** in that workflow (today: the
repo owner). Nothing to configure. Make sure GitHub → Settings → Notifications →
Actions has failed-workflow email turned on.

**Detection window: up to about 24h** (one check a day). We chose that over a
CloudWatch alarm with SNS. With near-zero traffic an error-rate alarm sits in
`INSUFFICIENT_DATA`, and the SPA fallback rewrites most 4xx to 200 anyway.

The real window can reach **about 48h**. The default behavior uses `CACHING_OPTIMIZED`
(24h default TTL, and query strings aren't in the cache key, so you can't cache-bust).
After an origin breaks, edge-cached `/` and `/config.json` can keep passing until they
expire.

### Caveat: 60-day auto-disable

GitHub **disables scheduled workflows in a public repo after 60 days without a commit**
and sends a warning email first. If the repo goes quiet, re-enable it under Actions →
Web uptime (prod) → "Enable workflow", or push any commit.

## Testing the alert

Run the workflow by hand against a URL that fails:

```bash
gh workflow run web-uptime.yml -f url=https://bookshelf.whoiskevinrich.com/nope
```

`/nope/config.json` falls through to `index.html`, so the run fails on "not valid
JSON". Manual runs notify only the person who triggered them. To exercise the
scheduled-run email path, you have to wait for a scheduled failure.

## E2E against the deployed dev site

`e2e-deployed` sets `APP_BASE_URL` to the dev CloudFront URL (looked up from the
`BookshelfWeb` output) and `API_BASE_URL` to `<url>/api`. A non-localhost
`APP_BASE_URL` makes `playwright.config.ts` skip its local `webServer`. Login goes
through the native `/auth/login` form, so there are no OAuth redirects. It runs after
the localhost job (`needs`) because both drive the one shared QA account. See
`docs/runbooks/e2e-testing.md`.

Run it locally the same way. `.env.test.local.example` has the override lines.
