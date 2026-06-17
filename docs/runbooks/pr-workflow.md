# Runbook: Opening a Pull Request

Follow these steps before running `gh pr create`. All CI checks must be green before merging.

> **You no longer bump the version.** The release version is derived automatically
> by the deploy workflow at merge time (`max(existing v* tags) + 1`) — see
> [ADR-017](../adrs/017-ci-derived-release-versions.md). `package.json` version is
> pinned to `0.0.0` and is not the release identity. Do not edit it, and do not
> create tags by hand.

---

## Pre-PR Checklist

### 1. Verify locally (optional but fast)

```powershell
pnpm preflight
```

Runs `format → lint → test → qa:guards → synth` in sequence — a local dry-run of all CI checks. Fix any failures before pushing.

### 2. Push and open the PR

```powershell
git push -u origin <branch>
gh pr create
```

---

## CI Checks Reference

| Check          | What it validates                                                                                                                                                               | How to fix if red                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Format**     | All files pass `prettier --check .`                                                                                                                                             | `pnpm format` then commit                                                                             |
| **Lint**       | ESLint passes across all packages                                                                                                                                               | Fix lint errors, then commit                                                                          |
| **Unit Tests** | All Vitest suites pass                                                                                                                                                          | Fix failing tests, then commit                                                                        |
| **CDK Synth**  | Infrastructure can be synthesised                                                                                                                                               | Fix CDK/config errors, then commit                                                                    |
| **QA Guards**  | `scripts/qa-guards.mjs` finds no `[auto]` violations (auth coverage, body limit, no auth bypass, no committed env, ISBN via `lib/isbn.ts`, banned UI classes, no `console.log`) | Run `pnpm qa:guards`, fix the reported `file:line`, then commit — see `docs/runbooks/qa-checklist.md` |

---

## How formatting is enforced

The `pre-commit` Husky hook runs `pnpm format` (`prettier --write .`) automatically on every commit. You should never need to run it manually before pushing — it happens at commit time. If you bypassed hooks with `--no-verify`, run `pnpm format` and amend or create a new commit.

---

## Versioning rules

- **The deploy workflow assigns the version.** On merge to `main` it computes
  `max(existing v* tags) + 1` (patch) and creates the tag after smoke tests pass.
  You never bump `package.json`, never run a bump command, and never create tags
  by hand — doing so has no effect on the release number.
- Root `package.json` and all workspace packages are pinned to `0.0.0`; they are
  private, never published, and carry no release meaning.
- Need a **minor or major** bump? Edit the "Compute next version" step in
  `.github/workflows/deploy.yml`, or push a tag like `v0.2.0` to `main` so the next
  computed version continues from it.

See [ADR-017](../adrs/017-ci-derived-release-versions.md) (current mechanism) and
[ADR-007](../adrs/007-monorepo-versioning-strategy.md) (root-only scope) for the
versioning decision records.
