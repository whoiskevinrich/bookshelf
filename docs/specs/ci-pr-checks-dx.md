# Spec: CI PR Checks — Developer Experience

**Status**: Accepted  
**Date**: 2026-06-02  
**Author**: Kevin Rich

---

## Problem Statement

Two GitHub Actions checks consistently fail on pull requests before a developer has a chance to merge: **Unique Version** and **Format**. Because these checks are gating (PRs cannot merge while they are red), every contributor must manually perform additional steps after pushing — bump the version number and run the formatter — then push again. This friction adds a rework loop to every PR, slows down the change process, and makes the CI signal feel unreliable.

The **Unique Version** check fails because `package.json` version `v0.1.3` is already tagged on `main`. Any branch that doesn't first bump the version will fail this check. The **Format** check fails because formatting is only checked at push time (via `pre-push` hook) and only reports errors — it does not fix them.

---

## Goals

1. A developer can open a PR and have both **Unique Version** and **Format** checks pass without any manual rework after the initial push.
2. Version bumping is a deliberate, low-friction step that happens once per PR (not per push).
3. Formatting is enforced locally so CI is never the first place a developer learns their code is unformatted.
4. The CI signal is trustworthy: a green run means the code is genuinely ready to merge.
5. The workflow is documented where the developer and Claude already look — in `docs/runbooks/`.

---

## Non-Goals

- **Automated version bumping by CI**: CI should not commit version changes on behalf of the developer — that would obscure intent and create race conditions on shared branches.
- **Changing the version scheme**: Semver + git tags is the right model; the goal is to make it easy to follow, not replace it.
- **Auto-fixing format errors in CI**: CI auto-committing formatted code introduces noise and removes local ownership of code style.
- **Enforcing conventional commits or changelog generation**: Out of scope for this spec; may be a future enhancement.
- **Changing which checks are required**: All four CI checks (Lint, Format, Unit Tests, CDK Synth) plus Unique Version remain required.
- **CONTRIBUTING.md**: This is a solo project operated by the developer and Claude. Instructions belong in `docs/runbooks/` where CLAUDE.md already points, not a separate contributor file.

---

## User Stories

### Developer opening a new PR

- **As a developer**, I want to know the current version and how to bump it before I push, so that my PR doesn't fail the Unique Version check.
- **As a developer**, I want my commits to be auto-formatted at commit time, so that the Format check never fails in CI.
- **As a developer**, I want the version bump step to be a single command (`pnpm version:bump`), so that I don't have to remember the exact `npm version` invocation.

### Developer who got red checks

- **As a developer whose PR is red**, I want clear remediation steps in a runbook, so that I can fix both issues in under two minutes.

### Claude assisting with a PR

- **As Claude**, I want a runbook that documents the pre-PR checklist, so that I can follow it consistently at the start of every PR session without being told.

---

## Requirements

### Must-Have (P0)

1. **`pnpm version:bump` script**  
   A script in root `package.json` that runs `npm version patch --no-git-tag-version`, incrementing the patch version in place without creating a git tag (tags are created by the deploy workflow).  
   _Acceptance_: Running `pnpm version:bump` increments `version` in root `package.json` only; the next CI run passes Unique Version.  
   _ADR_: [007-monorepo-versioning-strategy.md](../adrs/007-monorepo-versioning-strategy.md)

2. **Husky `pre-commit` auto-formats**  
   `.husky/pre-commit` runs `pnpm format` (`prettier --write .`) so every commit is formatted before it lands. The full test suite is removed from `pre-commit` (tests run in CI).  
   `.husky/pre-push` is cleared — formatting is already handled at commit time.  
   _Acceptance_: Committing an unformatted file automatically formats and stages it; `pnpm format:check` passes; CI Format check passes.  
   _ADR_: [006-git-hooks-strategy.md](../adrs/006-git-hooks-strategy.md)

3. **Workspace packages set to `0.0.0`**  
   `apps/api/package.json` and `apps/web/package.json` versions set to `0.0.0` to signal they are not independently versioned. Root `package.json` bumped to `0.1.4`.  
   _Acceptance_: Only root `package.json` ever changes version on release.

4. **`docs/runbooks/pr-workflow.md`**  
   Runbook covering: (a) run `pnpm version:bump` before opening a PR, (b) how `pnpm format` and `pnpm preflight` work, (c) what each CI check validates and how to fix it if red.  
   _Acceptance_: Following the runbook produces a green PR on the first push.

### Nice-to-Have (P1)

5. **`pnpm preflight` script**  
   Runs `pnpm format`, `pnpm lint`, and `pnpm test` in sequence — a local dry-run of CI before pushing.  
   _Acceptance_: `pnpm preflight` exits 0 on a clean repo; non-zero if any check fails.

6. **CI error message links to runbook**  
   The Unique Version step's `::error::` message includes the path to `docs/runbooks/pr-workflow.md`.  
   _Acceptance_: Error output in GitHub Actions tells the developer exactly where to look.

### Future Considerations (P2)

7. **Auto-trigger version bump post-merge**: `version-bump.yml` already exists as a `workflow_dispatch` that opens a bump PR on demand. The remaining step is wiring it to trigger automatically after a merge to `main`, so the next branch is always pre-bumped. Requires a PAT with workflow permissions.
8. **Commitizen / semantic-release**: Replace manual version bumping with conventional commits driving automated versioning — separate ADR required.

---

## Decisions Made

| Question                                      | Decision                                    | ADR                                                    |
| --------------------------------------------- | ------------------------------------------- | ------------------------------------------------------ |
| Hook tool: Husky vs. Lefthook vs. none        | Keep Husky; fix `pre-commit` to auto-format | [ADR-006](../adrs/006-git-hooks-strategy.md)           |
| Version scope: root-only vs. sync workspaces  | Root-only; workspaces set to `0.0.0`        | [ADR-007](../adrs/007-monorepo-versioning-strategy.md) |
| Contributor docs: CONTRIBUTING.md vs. runbook | Runbook at `docs/runbooks/pr-workflow.md`   | —                                                      |

---

## Success Metrics

| Metric                         | Target               | Window  |
| ------------------------------ | -------------------- | ------- |
| Unique Version failures per PR | 0 (after this lands) | Ongoing |
| Format failures per PR         | 0 (after this lands) | Ongoing |
| Rework pushes per PR           | 0                    | Ongoing |

---

## Timeline Considerations

- **No hard deadline**, but every PR opened before this lands is a tax on developer time.
- All P0 items are small — implementable in a single session.
- P1 items ship in the same PR.
- Unblocks all future PRs; prioritize ahead of feature work.
