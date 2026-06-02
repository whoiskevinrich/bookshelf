# ADR-007: Monorepo Versioning Strategy — Root-Only

**Status**: Accepted  
**Date**: 2026-06-02

## Context

The CI **Unique Version** check reads `version` from the root `package.json` and compares it against existing git tags. The check fails whenever the current version is already tagged — which is the case after every release unless the developer bumps the version before opening a PR.

The monorepo contains four packages:

| Package               | Current version |
| --------------------- | --------------- |
| `package.json` (root) | `0.1.3`         |
| `apps/api`            | `0.1.0`         |
| `apps/web`            | `0.1.0`         |
| `packages/infra`      | (not checked)   |

All workspace packages are `private: true` and are never published to a registry. They deploy together as a single product release.

Options considered:

1. **Root-only versioning** — bump only root `package.json`; CI gate already reads this file.
2. **Synchronized workspace versions** — bump all four files in lockstep on every release.
3. **Independent workspace versions** — each package tracks its own semver cadence.

## Decision

Root-only versioning. The root `package.json` version is the canonical release identifier and the sole target for version bumps. Workspace packages are marked as private, never published, and always deploy together — their individual versions carry no meaning to users or operators.

Workspace `package.json` files will be set to `0.0.0` as a convention signaling they are not independently versioned. This resolves the current cosmetic inconsistency (`0.1.0` vs `0.1.3`) without introducing ongoing maintenance burden.

Independent versioning (option 3) is overkill for a single-product app. Synchronized versioning (option 2) requires bumping four files on every release with no benefit over option 1.

A `pnpm version:bump` script will be added to the root `package.json` to make the bump step a single command, reducing the chance that developers forget it before opening a PR.

## Consequences

- One file to update per release; lower friction, lower error rate.
- Workspace packages showing `0.0.0` is an explicit signal, not an oversight.
- If a workspace package is ever extracted into a publishable library, it will need its own versioning at that point — this is a low-cost future change.
- The CI version gate continues to work without modification.
