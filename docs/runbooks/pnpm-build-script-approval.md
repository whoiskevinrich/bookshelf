# Runbook: pnpm Build-Script Approval

**Status:** Active
**Date:** 2026-05-30
**Applies to:** Monorepo root (`package.json`), pnpm v10+

---

## Context

pnpm v10 does **not** run dependency lifecycle scripts (`preinstall` / `install` / `postinstall`) by default. Packages whose scripts are blocked are reported during a clean `pnpm install`:

```
╭ Warning ─────────────────────────────────────────────────────────────────────╮
│   Ignored build scripts: esbuild@0.21.5.                                       │
│   Run "pnpm approve-builds" to pick which dependencies should be allowed       │
│   to run scripts.                                                              │
╰────────────────────────────────────────────────────────────────────────────────╯
```

For `esbuild`, the blocked `postinstall` is what downloads the platform-specific
native binary. If it is skipped, `esbuild` (and therefore `vitest`, which depends
on it in `@bookshelf/infra`) cannot run. So this is a correctness issue, not just
a cosmetic warning.

The warning only appears on a **clean** install (full dependency resolution). A
warm `pnpm install` against an up-to-date lockfile skips resolution and stays
silent, which can mask the problem in CI caches.

## Decision

Approved build scripts are pinned explicitly in the root `package.json` so the
allowlist is version-controlled and reproducible (rather than relying on the
interactive `pnpm approve-builds`, which writes to a local pnpm state file):

```json
"pnpm": {
  "onlyBuiltDependencies": [
    "esbuild"
  ]
}
```

Only dependencies that genuinely need a build step are listed. Keeping the list
minimal preserves pnpm's default protection against arbitrary install-time code
execution from the rest of the dependency tree.

## Procedure

### Verify a clean install is warning-free

```bash
# from the monorepo root
rm -rf node_modules packages/infra/node_modules
pnpm install
```

Expected: exit 0, no "Ignored build scripts" warning, and esbuild's postinstall
runs (`.../esbuild postinstall: Done`).

### When a new dependency reports an ignored build script

1. Confirm the script is actually required (native binary, codegen, etc.) — many
   are not, and ignoring them is the safer default.
2. If required, add the package name to `pnpm.onlyBuiltDependencies` in the root
   `package.json`.
3. Re-run a clean install (above) to confirm the warning is gone and the script
   ran.
4. Commit the `package.json` change.

## References

- pnpm docs: `onlyBuiltDependencies` / `pnpm approve-builds`
- Affected package: `esbuild@0.21.5` (transitive via `vitest` in `@bookshelf/infra`)
