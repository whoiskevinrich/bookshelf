# ADR-006: Git Hooks Strategy — Husky with Auto-Format on Commit

**Status**: Accepted  
**Date**: 2026-06-02

## Context

Two CI checks consistently fail on pull requests: **Format** and **Unique Version**. The Format check fails because formatting is only checked at push time (via `.husky/pre-push`) and only reports errors — it does not fix them. This creates a rework loop: push → CI red → run `pnpm format` → push again.

Husky v9 is already installed (`devDependencies`) and two hooks exist:

- `pre-commit` → `pnpm test` (full suite)
- `pre-push` → `pnpm format:check` (check only)

Options considered:

1. **Keep Husky, fix the hooks** — move `prettier --write` into `pre-commit`; optionally scope to staged files with `lint-staged`.
2. **Replace with Lefthook** — YAML-based, parallel execution, built-in staged-file scoping.
3. **No local hooks** — rely entirely on CI for enforcement.

## Decision

Keep Husky. Reconfigure the hooks so that:

- `pre-commit` runs `prettier --write .` (auto-fix, not check) and then stages the formatted changes before the commit lands. No full test run on commit — that belongs in CI.
- `pre-push` is removed or left empty; formatting is already handled at commit time.

Lefthook was not chosen because Husky is already installed and the required fix is a 2-line change. Switching tools would be churn with no functional gain for this project.

The full test suite is removed from `pre-commit` because slow hooks get bypassed with `--no-verify`, defeating the purpose. Tests run in CI on every push; that is sufficient.

## Consequences

- The Format CI check will pass on every PR because all commits are formatted before they leave the developer's machine.
- Commit time increases slightly (Prettier is fast; negligible on this codebase).
- Developers who bypass hooks with `--no-verify` will still hit the CI check — acceptable last-resort protection.
- `lint-staged` is not added; running Prettier on the whole repo is fast enough and avoids the complexity of a staged-files pipeline. Revisit if the repo grows significantly.
