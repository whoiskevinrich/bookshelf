# ADR-017: CI-Derived Release Versions (Duplicate Versions Made Impossible)

**Status**: Accepted
**Date**: 2026-06-15
**Supersedes**: the _enforcement mechanism_ of [ADR-007](007-monorepo-versioning-strategy.md) (root-only versioning stays; the per-PR bump + "Unique Version" gate is removed)

## Context

Release `v0.1.46` was promoted twice. The second promotion ([run 27596010432](https://github.com/whoiskevinrich/bookshelf/actions/runs/27596010432/job/81587945344)) deployed to **prod successfully**, then failed on the final step — `gh release create v0.1.46` returned `HTTP 422: Release.tag_name already exists`. A successful prod deploy was reported as a red build.

Root cause: two PRs landed on `main` carrying the **same** `package.json` version.

| commit    | PR  | package.json | outcome                                         |
| --------- | --- | ------------ | ----------------------------------------------- |
| `10d803e` | #70 | `0.1.46`     | deploy → created release **v0.1.46** ✅         |
| `ec87d54` | #71 | `0.1.46`     | prod deploy OK, then `gh release create` 422 ❌ |

Both PRs branched off `main` at `0.1.45`. The **Unique Version** gate (`version-gate.yml`) ran on `pull_request` and bumped each branch `0.1.45 → 0.1.46` independently, because at PR-open time the `v0.1.46` tag did not yet exist. The gate could not see the other in-flight PR.

The old design had three structural flaws:

1. **Uniqueness checked on the wrong event.** The gate ran per-PR, in parallel; N concurrent PRs off the same base all reserve the same number. Uniqueness is a property that only holds when serialized at the moment code lands, not at PR-open time.
2. **Uniqueness checked against a mutable ledger.** The gate compared against git **tags**, but the deploy created them with `git tag -f` / `git push -f`. A force-moved tag is not a record of "this version shipped."
3. **The only immutable check happened last, after prod was already deployed.** The GitHub Release is the one immutable artifact, and nothing consulted it until `gh release create` — too late to prevent anything, early enough to turn a good deploy red.

## Decision

**Stop reserving a version on a branch. Derive it at the serialized moment of deploy, from the immutable tag ledger, and treat the GitHub Release creation as idempotent.**

On push to `main`, the deploy job computes the next version as `max(existing v* tags) + 1` (patch). The `deploy-dev` concurrency group already serializes `main` builds (`cancel-in-progress: false`), so each build reads the ledger _after_ the previous build pushed its tag — the computed number is always fresh.

This makes duplicate versions impossible by construction:

- **No branch-time reservation.** Parallel PRs can no longer pre-claim a number; the number is assigned only when the merged commit deploys.
- **Serialized assignment.** Queued `main` deploys compute `max+1` one at a time. Run B sees run A's tag before it computes.
- **Fail-closed, not fail-after-prod.** Version tags are created **non-forced** (`git tag` / `git push`, no `-f`). If a collision were ever attempted it fails _before_ any deploy, not after prod.
- **Idempotent release.** `gh release create` is guarded by a `gh release view` existence check, so a re-run (or a promote of an already-released version) is a no-op instead of a 422.

`package.json` version is no longer the release source of truth. The git tag created by CI **is** the release identity. The root `version` field is pinned to `0.0.0` (the same convention the workspace packages already use per ADR-007). Nothing reads `package.json` version at app runtime — the version reaches the app only via CDK `-c version` (the S3 build prefix, CloudFront `originPath`, the `/bookshelf/web/active-version` SSM param, and the `Version` stack tag — see `packages/infra/lib/web-stack.ts`).

### Alternatives considered

- **Keep `package.json` authoritative, add a serialized merge-time guard.** Still relies on a human/PR bump landing in the file, and keeps the `pnpm version:bump`-before-PR friction (and the `gh pr create` auto-bump commit). Rejected: more moving parts, same class of footgun.
- **`semantic-release` / `changesets`.** Full conventional-commit tooling earns minor/major bumps automatically. Overkill for a solo single-product app today; the `max+1` patch scheme is a 2-way door — switching later is a drop-in replacement of the "Compute next version" step.

## Implementation

- **`deploy.yml`** — replace the "Resolve version" step (which read `package.json`) with "Compute next version" (reads `git tag --sort=-version:refname`, bumps patch, loops past any tag/release that already exists for paranoia). The version tag is still created at the **end**, only after smoke passes (ADR-003's "a tag means deployed-and-smoke-tested" invariant is preserved), but now **non-forced**. The job outputs the computed version for the prod promote.
- **`promote.yml`** — remove the `package.json`-equality check (meaningless now; the checked-out `v$version` tag _is_ the deployed tree). Make `gh release create` idempotent via a `gh release view` guard.
- **`version-gate.yml`** — deleted. PRs no longer touch the version.
- **`package.json`** — root `version` pinned to `0.0.0`; `version:bump` script removed.
- **Docs** — `docs/runbooks/pr-workflow.md` drops the "Bump the version" step and the **Unique Version** check row; `CLAUDE.md` drops the `gh pr create` auto-bump caveat.

## Consequences

**Good**

- Duplicate release versions are structurally impossible — the failure that prompted this ADR cannot recur.
- Re-running a deploy or promote is safe (idempotent release; no red build on a successful deploy).
- Tags are immutable again (no `-f`), restoring the rollback ledger's integrity (ADR-003).
- DX win: no pre-PR bump, no auto-bump commit on `gh pr create`, no **Version Bump** workflow, one fewer CI check.

**Trade-offs**

- Versioning is **patch-only** by construction. Minor/major bumps now require editing the "Compute next version" step or adopting changesets (noted above).
- The version is not known until deploy time — you can no longer read the to-be-released number off the branch. Acceptable: it is visible in the deploy run summary and as the pushed tag.
- A force-push that rewrote `main`'s tags out of band would confuse `max+1`; tags are managed only by CI, which never force-pushes them under this design.
