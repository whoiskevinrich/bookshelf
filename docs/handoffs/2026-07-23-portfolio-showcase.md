# Handoff: Portfolio showcase (BOOKSHELF-105)

**Date:** 2026-07-23
**Ticket:** [BOOKSHELF-105](https://whoiskevinrich.atlassian.net/browse/BOOKSHELF-105) — In Review
**PR:** [#132](https://github.com/whoiskevinrich/bookshelf/pull/132) (open, not yet merged)
**Branch:** `BOOKSHELF-105-portfolio-showcase`

## Status: essentially done, PR open for review

This started as a `/debug` on GitHub Actions and pivoted into making the repo
public for Kevin's whoiskevinrich.com portfolio. Most of the work is
committed and pushed; only merge + a step outside this repo remain.

## How this got here

- `/debug` on the Actions tab surfaced two unrelated CI issues: (a) every
  `Dependabot Updates` run since ~May 2026 has timed out after 24h waiting
  for a self-hosted runner labeled `dependabot` that doesn't exist, (b) E2E
  flakiness from live Google Books 503s (pre-existing, untouched here).
- Kevin recalled that Dependabot explicitly refuses self-hosted runners on
  **public** repos (confirmed against GitHub docs), which would sidestep (a)
  — but going public to route around a misconfigured setting isn't the
  correct fix. The real fix for (a) is unrelated to visibility: flip
  "Dependabot on Actions runners" from self-hosted to GitHub-hosted in
  **Settings → Code security and analysis → Dependabot**. That work is
  tracked separately — see "Spun off" below, don't duplicate it here.
- Separately, Kevin wants Bookshelf on his portfolio, which does require the
  repo to be public — that's the actual reason for this PR.

## What was done

- **Security sweep before flipping visibility** (all clean): grepped full
  git history for AWS keys, private-key blocks, `.env` commits, and
  API-key/JWT-shaped strings — nothing found. Confirmed `pr.yml`/`e2e.yml`/
  `deploy.yml` all trigger on `pull_request` (never `pull_request_target`),
  so fork PRs can't reach secrets. Commit author/committer email is Kevin's
  real `whoiskevinrich@gmail.com` (not a GitHub no-reply address) — he
  chose to leave it as-is since the portfolio is already under his real
  identity.
- Repo visibility flipped to **public**: https://github.com/whoiskevinrich/bookshelf
- Added `README.md` — project overview, tech stack, monorepo layout, local
  dev pointer.
- Added `.showcase.md` at repo root (consumed by the portfolio's nightly
  sync) — description, tags, url. Tags include `WebAssembly`, called out
  specifically because the barcode/OCR scanning stack (`zxing-wasm` +
  `tesseract.js`, tiered against native `BarcodeDetector`/`TextDetector`
  browser APIs, self-hosted not CDN-served) was the standout technical
  detail Kevin wanted highlighted. No `version` override — the repo already
  cuts real GitHub releases (latest `v0.7.0` at time of writing), so the
  portfolio picks that up automatically.
- Set GitHub About (description, homepage, topics) to match `.showcase.md`.
- PR #132 opened with `Release-Note: no user-facing note` (repo/portfolio
  metadata only, doesn't touch the shipped app).

## Remaining

- [ ] Review + merge PR #132
- [ ] Register the project in the **portfolio repo** (`G:\source\showcase`,
      `scripts/projects.registry.mjs`):
      `{ slug: "bookshelf", repo: "whoiskevinrich/bookshelf", featured: false, order: <n> }`
      — `featured`/`order`/`title` are editorial, Kevin's call, not this
      repo's.
- [ ] Run `pnpm sync:projects` in the showcase repo (or wait for its
      nightly job) so the card actually appears.

## Known side effect — don't re-diagnose this, it's already tracked

Going public turned on GitHub's free secret/vulnerability scanning for the
first time and it immediately surfaced **6 Dependabot security alerts (3
high, 2 moderate, 1 low)**:
https://github.com/whoiskevinrich/bookshelf/security/dependabot — almost
certainly unpatched the whole time the Dependabot workflow was silently
failing.

## Spun off (separate session, do not duplicate here)

A new session was spawned to (1) fix the actual Dependabot runner
misconfiguration described above and (2) triage/remediate the 6 alerts.
Check for an in-progress or completed session on that before starting
overlapping work.
