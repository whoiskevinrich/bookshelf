# ADR-025: Formatting Gate — Belt-and-Suspenders (Fix, Don't Mutate at the Gates)

**Status**: Proposed
**Date**: 2026-07-04
**Supersedes**: [ADR-006](./006-git-hooks-strategy.md)

## Context

ADR-006 decided that `.husky/pre-commit` would run `prettier --write` and **"stage the
formatted changes before the commit lands."** The staging half was never implemented: the
hook is a bare `pnpm format` (`prettier --write .`), which writes fixes to the working tree
but cannot re-stage them. Result — Prettier's corrections strand in the working tree while
the _already-staged_ unformatted bytes get committed; CI `prettier --check` then fails. This
has turned effectively every recent PR's **Format** check red (resolved each time by manually
committing the already-written changes, e.g. `04986b7`).

The root cause is structural, not a one-line miss: **the hook mutates files during the
commit.** Any mutate-during-commit design carries re-stage fragility — a future hand-rolled
`prettier --write` reintroduces the identical bug. Compounding it, formatting was enforced in
exactly one fragile place, so a single gap fails the whole PR.

A second, latent hazard is specific to this Windows + `core.autocrlf=true` setup: the working
tree is CRLF while the index and CI are LF (`git ls-files --eol` → `i/lf w/crlf`). Today
`endOfLine: "auto"` in `.prettierrc.json` absorbs this, so `prettier --check` does **not**
false-fail — but that safety rests entirely on one config line. A committed `.gitattributes`
makes the working tree deterministically LF on checkout, so the local gate matches CI
byte-for-byte independent of the prettier `endOfLine` setting and of other LF-expecting
tooling.

### Options considered

1. **Patch the hook** — add `git add` of the written files. Fixes today's failure, keeps the
   fragile mutate-at-commit model and the whole bug class.
2. **lint-staged at commit** (ADR-006 had deferred this) — stashes, formats staged files,
   re-stages by design. Correct fix for the re-stage bug, but still mutation-at-commit and
   still the only enforcement layer.
3. **CI auto-fixes and pushes a commit** — zero local burden, but bot-commit noise, push
   races, and loss of local ownership; already rejected as a non-goal in `ci-pr-checks-dx.md`.
4. **Belt-and-suspenders** — layer editor + commit (fixing) with push + CI (read-only
   gating), plus `.gitattributes` LF normalization.

## Decision

Adopt **option 4**. Enforce formatting in four layers that share one Prettier binary and one
config, governed by two invariants:

- **Fixing is separated from gating.** Only the editor (format-on-save) and the commit
  (`lint-staged`) _mutate_ files. The push hook and CI _only check_ (`prettier --check`).
  A read-only gate has nothing to stage, so the re-stage bug is **unreachable** at the gate
  layers; and the one mutating gate, `lint-staged`, re-stages by design.
- **The working tree is deterministically LF.** A committed `.gitattributes`
  (`* text=auto eol=lf`) pins the checkout to LF on every machine, so the local `--check` is
  byte-identical to Linux CI regardless of the prettier `endOfLine` setting or per-machine
  `core.autocrlf`. (Today `endOfLine: auto` already absorbs the mismatch; `.gitattributes`
  removes the reliance on that single line.)

```
edit ─▶ [editor: format-on-save]        fix, continuous
 add ─▶ [pre-commit: lint-staged]       fix staged files + RE-STAGE
push ─▶ [pre-push: prettier --check]    read-only gate (== CI)
  CI ─▶ [Format job: prettier --check]  immovable backstop
```

Concretely:

- `.gitattributes` `* text=auto eol=lf` (+ `binary` for images/fonts/pdf), landed **first**
  as a dedicated `git add --renormalize .` commit.
- `.husky/pre-commit` → `pnpm exec lint-staged`; config `{ "*": "prettier --ignore-unknown --write" }`.
- `.husky/pre-push` → `pnpm format:check` (restored; read-only).
- `.vscode/settings.json` (committed): format-on-save, default formatter
  `esbenp.prettier-vscode`, `prettier.prettierPath: node_modules/prettier`; plus
  `.vscode/extensions.json` recommending the extension.

This **reverses two ADR-006 sub-decisions**: lint-staged is now adopted (ADR-006 deferred it
_for repo size_; we adopt it _for correctness_ — it re-stages, whole-repo `prettier --write`
does not), and `pre-push` is restored as a read-only check (ADR-006 removed it). It **keeps**
ADR-006's core choice of Husky over Lefthook.

## Consequences

- The Format CI check passes on every PR because fixes land in the commit (re-staged) and
  the pre-push check mirrors CI before code leaves the machine.
- The "wrote-but-didn't-stage" failure is **structurally impossible** at the gates — no
  future hook edit can bring it back, because the gates never write.
- CRLF/LF drift is made deterministic by `.gitattributes` (LF working tree everywhere),
  removing the repo's reliance on `endOfLine: auto` to paper over a CRLF checkout; existing
  working trees convert to LF on the next clone or `git add --renormalize .`.
- Version-skew tug-of-war (editor Prettier ≠ repo Prettier) is prevented by pinning
  `prettier.prettierPath` to `node_modules/prettier`.
- Four layers is more moving parts than ADR-006's single hook; the mitigation is that all
  four call one binary against one config, so there is one definition of "formatted" to keep
  in sync, not four.
- `--no-verify` on both commit and push still reaches CI — the intended last-resort gate.
- Commit speed improves slightly: `lint-staged` formats only staged files, not the whole repo.

## Migration

1. Land `.gitattributes` + `git add --renormalize .` as its own commit (mechanical LF churn,
   kept separate from logic changes).
2. Add `lint-staged` dep + config; rewrite the two hooks; add the `.vscode/` files.
3. Verify: (a) unformatted file → commit → `git show HEAD:<file>` is formatted;
   (b) `--no-verify` commit → push blocked by pre-push; (c) `pnpm format:check` passes on the
   Windows working tree post-renormalize.
