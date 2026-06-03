# Runbook: Opening a Pull Request

Follow these steps before running `gh pr create`. All five CI checks must be green before merging.

---

## Pre-PR Checklist

### 1. Bump the version

Every PR must carry a version not yet tagged on `main`. Run:

```powershell
pnpm version:bump
```

This increments the patch version in root `package.json` (e.g. `0.1.4` → `0.1.5`) without creating a git tag. Tags are created automatically by the deploy workflow on merge.

**When to run**: Once per branch, before the first push. If you forget and the **Unique Version** check fails, run it and push again.

### 2. Verify locally (optional but fast)

```powershell
pnpm preflight
```

Runs `format → lint → test → synth` in sequence — a local dry-run of all CI checks. Fix any failures before pushing.

### 3. Push and open the PR

```powershell
git push -u origin <branch>
gh pr create
```

---

## CI Checks Reference

| Check              | What it validates                        | How to fix if red                  |
| ------------------ | ---------------------------------------- | ---------------------------------- |
| **Unique Version** | `package.json` version is not yet tagged | `pnpm version:bump` then push      |
| **Format**         | All files pass `prettier --check .`      | `pnpm format` then commit          |
| **Lint**           | ESLint passes across all packages        | Fix lint errors, then commit       |
| **Unit Tests**     | All Vitest suites pass                   | Fix failing tests, then commit     |
| **CDK Synth**      | Infrastructure can be synthesised        | Fix CDK/config errors, then commit |

---

## How formatting is enforced

The `pre-commit` Husky hook runs `pnpm format` (`prettier --write .`) automatically on every commit. You should never need to run it manually before pushing — it happens at commit time. If you bypassed hooks with `--no-verify`, run `pnpm format` and amend or create a new commit.

---

## Versioning rules

- Only root `package.json` is versioned. Workspace packages (`apps/api`, `apps/web`) are `0.0.0` — they are private and never published independently.
- `pnpm version:bump` always does a **patch** increment. For minor or major bumps, edit `package.json` directly or use the **Version Bump** workflow (see below).
- Git tags (`v0.1.x`) are created by the deploy workflow on merge to `main` — never create them manually.

See [ADR-007](../adrs/007-monorepo-versioning-strategy.md) for the versioning decision record.

## Version Bump workflow (GitHub Actions)

For patch, minor, or major bumps without opening a local branch, use the **Version Bump** workflow:

1. Go to **Actions → Version Bump → Run workflow** in GitHub.
2. Select bump type (`patch`, `minor`, `major`).
3. The workflow opens a PR named `chore: bump version to vX.Y.Z` — review and merge it before opening your feature PR.

This is equivalent to running `pnpm version:bump` locally and pushing, but can be triggered from the GitHub UI without a local checkout.
