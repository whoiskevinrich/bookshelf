# ADR-020: Release Please as the dev→prod Promotion Gate

**Status**: Accepted
**Date**: 2026-06-30
**Supersedes**: the _release-identity and promotion mechanism_ of [ADR-017](017-ci-derived-release-versions.md) (CI-derived integer version + the unconditional auto-promote chain). ADR-017's **anti-duplicate guarantee is preserved**, by different means (see below). The root-only `0.0.0` pinning of [ADR-007](007-monorepo-versioning-strategy.md) is retained.

## Context

Today (`deploy.yml`) every merge to `main`:

1. auto-deploys to **dev**,
2. computes the version as `max(existing v* tags) + 1` (ADR-017),
3. runs smoke tests, tags the commit, then
4. the `promote` job (`needs: deploy`) **unconditionally promotes to prod**.

So **prod follows dev on every green merge — there is no human gate**, and every merge is its own patch release.

Two capabilities we want today are not served by this:

- **Batch related features into one deliberate prod release**, with semantic versioning and a changelog — rather than a patch per merge with prod auto-following.
- **A human gate before prod**, so **dev is the manual-test surface** and we avoid standing up a dedicated QA environment.

Constraint: ADR-017 was born from a duplicate-`v0.1.46` incident caused by **file-based version reservation on parallel branches**. Any change must not reopen that failure mode.

## Decision

**Adopt [`googleapis/release-please`](https://github.com/googleapis/release-please) as the release-cataloging tool _and_ the prod promotion gate.** The standing release PR becomes the deliberate "ship to prod" action; dev stays continuous.

### Flow

- **Dev stays continuous.** Every merge to `main` auto-deploys to dev as today, but under the **short commit SHA** (`-c version=dev-<sha>` → S3 prefix, `/bookshelf/web/active-version` SSM param, CloudFront `originPath`, `Version` stack tag). **Dev no longer computes or pushes semver tags.**
- **Release Please maintains a release PR** on `main`, accumulating Conventional Commits and bumping semver (`feat`→minor, `fix`→patch, `!`/`BREAKING CHANGE`→major), writing `CHANGELOG.md` and `.release-please-manifest.json`.
- **Merging the release PR is the gate.** Release Please creates the tag `vX.Y.Z` and the GitHub Release.
- **`promote.yml` runs automatically** when a release is cut → prod (+ prod smoke). The PR review _is_ the gate; past it, promotion is automatic. The chain is wired as a `workflow_call` from `release-please.yml` on the action's `release_created` output — **not** an `on: release: published` trigger, because a release created by the default `GITHUB_TOKEN` does not trigger other workflows.
- **Conventional Commits are enforced on the squash-merge PR title**, but **auto-corrected** (default `chore:` prefix via `gh pr edit`) when invalid, rather than blocking the merge — keeping manual churn out of the loop.

### How ADR-017's anti-duplicate guarantee is preserved

ADR-017's failure was N parallel PRs each reserving the same number against a mutable tag ledger. Release Please closes this by a different mechanism:

- **One release PR at a time.** Version assignment is serialized through that single PR's merge. Feature PRs never touch the version; only the Release Please action edits the manifest, inside the release PR.
- **Release creation is owned and idempotent.** Release Please creates the tag + Release; there is no human `gh release create` race, and re-runs are no-ops.

So duplicate versions remain impossible — by serialization through one PR rather than by deriving `max+1` at deploy.

### Dev rollback rework (the real cost)

ADR-003 / ADR-017 dev auto-rollback keys off the "last good version tag," which assumed **every dev deploy is tagged**. With dev no longer tagging:

- Rollback re-keys onto the **last successfully-smoked dev commit SHA**, recorded as a moving ref / SSM param (e.g. `/bookshelf/web/last-good-dev`) **updated only after dev smoke passes**.
- The invariant **"tag = deployed-and-smoke-tested in dev" moves to "this ref = last good dev"**; the semver **tag now means "release cut."**

This is the bulk of the implementation work — more than the Release Please wiring itself.

## Alternatives considered

- **Keep ADR-017 + a GitHub `prod` environment protection rule** (required reviewer on `promote.yml`). Gets the human gate with **zero new tooling and no ADR-017 reversal** — but delivers **neither** semver-from-commits **nor** a batched changelog. Rejected: batching + semver is a primary goal here, not just the gate.
- **`changesets`.** Designed for multi-package monorepos where packages version independently and publish to a registry. Bookshelf deploys as **one unit**; per-package changeset files add ceremony for no consumer. Release Please's single-manifest mode fits a single deployable better.
- **`semantic-release`.** Fully automatic release on every qualifying merge — **no standing PR, so no human batching gate.** Directly conflicts with the "deliberate gate" goal. Rejected.

## Implementation

- **`deploy.yml`** — remove the `promote` job (`needs: deploy`) and the "Compute next version" / "Tag deployed version" steps. Set `-c version=dev-<short-sha>`. Keep dev smoke + auto-rollback, re-keyed onto the `last-good-dev` SHA ref.
- **`release-please.yml`** (new) — `googleapis/release-please-action` on `push: main`. Use **`release-type: simple`** (tracks version in `.release-please-manifest.json` only) so **`package.json` stays pinned at `0.0.0`** (ADR-007). Add `release-please-config.json` + `.release-please-manifest.json` at the repo root.
- **`promote.yml`** — drive it by `workflow_call` (version input) from `release-please.yml`'s `promote` job, gated on `release_created == 'true'` (keep `workflow_dispatch` for manual re-promote / hotfix). A `resolve` step strips any leading `v` so both the `vX.Y.Z` tag (call) and a bare `1.2.3` (dispatch) work. **Not** an `on: release` trigger — see the `GITHUB_TOKEN` caveat above.
- **IAM** — the dev OIDC role needs `ssm:GetParameter` + `ssm:PutParameter` on `/bookshelf/web/last-good-dev` (new permission for the rollback ref).
- **PR-title lint** — add a non-blocking Conventional-Commit title check (e.g. `amannn/action-semantic-pull-request`) with an **auto-fix step** that prefixes a default `chore:` via `gh pr edit` when the title is invalid.
- **ADR-017** — mark superseded-in-part (release identity + promotion); its serialization _principle_ lives on.
- **Docs** — update `docs/runbooks/pr-workflow.md` and `docs/runbooks/cicd-setup.md`; add a `docs/decisions.md` row.

## Consequences

**Good**

- A deliberate, reviewable prod gate; **dev remains the always-fresh manual-test surface** — no dedicated QA environment needed.
- Related features **batch into one versioned release** with an auto-maintained changelog.
- Semver reflects `feat` / `fix` / breaking changes instead of patch-only.
- The anti-duplicate guarantee is preserved (serialization through the single release PR).

**Trade-offs**

- **Reintroduces a file-managed version** (the manifest) that ADR-017 removed — accepted because the race is closed by **serialization**, not by avoiding files.
- The **dev rollback ledger must be rebuilt on a SHA ref** — the main implementation cost.
- Requires **Conventional Commit discipline**; mitigated by the auto-fixing PR-title lint, but auto-prefixing `chore:` can under-classify a real `feat`/`fix` (author can still correct the PR title before merge).
- **Prod is no longer continuously deployed** — a fix reaches prod only when a release is cut. Acceptable (that's the point); for urgent hotfixes, cut a release PR immediately or run `promote.yml` via `workflow_dispatch`.
- The released version isn't known until the release-PR merge — visible in the release PR meanwhile.
