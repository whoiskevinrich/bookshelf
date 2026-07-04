# Spec: Formatting Gate Hardening — Belt-and-Suspenders

**Status**: Draft
**Date**: 2026-07-04
**Author**: Kevin Rich
**Supersedes the hook design in**: [ci-pr-checks-dx.md](./ci-pr-checks-dx.md) (§Requirements P0 #2)

---

## Problem Statement

The **Format** CI check has failed on effectively every recent PR. The root cause is not
CRLF/autocrlf this time — it is a structural flaw in the pre-commit hook.

`.husky/pre-commit` runs `pnpm format` (`prettier --write .`), which **writes fixes to the
working tree but never re-stages them**. Prettier's corrections therefore live only in the
working tree; the _already-staged_ (unformatted) bytes are what actually get committed. CI
runs `prettier --check` against those committed bytes and fails. The developer then has to
commit the already-written changes by hand to go green (as happened in commit `04986b7`).

This directly contradicts the accepted design in ADR-006 / `ci-pr-checks-dx.md`, whose
acceptance criterion was _"Committing an unformatted file automatically formats **and stages**
it."_ The staging half was specified but never implemented — `pnpm format` cannot stage.

The deeper issue: **the pre-commit hook mutates files during the commit.** Any
mutate-during-commit scheme carries this re-stage fragility; a future hand-rolled
`prettier --write` reintroduces the exact same bug. And because formatting is enforced in
only one fragile place, a single gap turns every PR red.

---

## Goals

1. A commit's formatting fixes always land **in that commit** — never stranded in the working tree.
2. Formatting drift is caught before it can ever reach the CI Format check, so CI is never
   the first place the developer learns code is unformatted.
3. The failure mode is eliminated **by construction**, not patched — no future edit to the
   hooks can resurrect the "wrote-but-didn't-stage" bug.
4. The local gate never _false-fails_ on a Windows CRLF working tree (the recurring
   autocrlf trap), so developers are never tempted to `--no-verify` past it.
5. Every enforcement layer agrees on one definition of "formatted" — no config drift
   between editor, commit, push, and CI.

---

## Non-Goals

- **CI auto-fixing and pushing a commit.** Rejected here for the same reason
  `ci-pr-checks-dx.md` rejected it: bot-commits add noise and remove local ownership of
  style. For a solo/one-machine repo the local layers are sufficient.
- **Switching hook tooling (Lefthook, etc.).** Husky stays — ADR-006's rationale holds.
- **Removing or weakening the CI Format gate.** CI `prettier --check` remains the immovable
  backstop; local layers are convenience, not a replacement.
- **Changing Prettier config or the set of formatted files.** This is about _where and how_
  the existing config is enforced, not _what_ it does.
- **Reformatting the whole repo for style reasons.** The only bulk change is the one-time
  `.gitattributes` LF renormalization (mechanical, its own commit).

---

## Design Overview — Four Layers, One Definition

Enforcement is layered so that no single gap turns CI red, and the two failure classes that
have bitten this repo (re-stage drift, CRLF false-fail) are structurally removed. Every layer
runs the **same Prettier binary** (the repo's pinned `node_modules/prettier`) against the
**same config** — only the _scope_ and _action_ differ.

| Layer  | Mechanism                                                            | Action                     | Scope             | Catches                                                 |
| ------ | -------------------------------------------------------------------- | -------------------------- | ----------------- | ------------------------------------------------------- |
| Editor | `.vscode/settings.json` format-on-save, pinned to workspace prettier | fix (continuous)           | file being edited | drift before it exists                                  |
| Commit | `.husky/pre-commit` → `lint-staged`                                  | fix + **re-stage**         | staged files      | anything the editor missed / tool-written files         |
| Push   | `.husky/pre-push` → `pnpm format:check`                              | **check only** (read-only) | whole repo        | anything both above missed; `--no-verify` commit bypass |
| CI     | `pr.yml` Format job → `pnpm format:check`                            | check only                 | whole repo        | immovable backstop; `--no-verify` push bypass           |

Two cross-cutting invariants make the layers trustworthy:

- **No mutation at push or CI.** The push and CI gates are read-only `--check`. A read-only
  gate has nothing to stage, so the re-stage bug is _unreachable_ at those layers — and
  `lint-staged` (not a hand-rolled `--write`) is the only mutating layer, and it re-stages
  by design.
- **LF-normalized working tree.** A committed `.gitattributes` (`* text=auto eol=lf`) makes
  the Windows working tree LF, so the local `prettier --check` is byte-identical to Linux
  CI and cannot false-fail on line endings.

---

## Requirements

### Must-Have (P0)

1. **`.gitattributes` LF normalization — landed first.**
   Root `.gitattributes` with `* text=auto eol=lf` plus `binary` rules for image/font/pdf
   assets (per the standard playbook). Applied as its own "normalize line endings" commit
   (`git add --renormalize .`).
   _Acceptance_: `git ls-files --eol <any text file>` reports `i/lf`; `pnpm format:check`
   passes on a fresh Windows checkout with no CRLF-driven failures.
   _Why first_: it makes the working tree LF on every checkout so the local `--check` matches
   CI deterministically, and keeps the mechanical normalization diff separate from the logic
   change. (Today `endOfLine: auto` in `.prettierrc.json` already prevents a CRLF false-fail;
   `.gitattributes` removes the reliance on that single line.)

2. **`lint-staged` at pre-commit (replaces bare `pnpm format`).**
   Add `lint-staged` dev-dependency; config `{ "*": "prettier --ignore-unknown --write" }`.
   `.husky/pre-commit` runs `pnpm exec lint-staged`. lint-staged formats only staged files
   and **re-stages them** before the commit lands.
   _Acceptance_: staging an unformatted file and committing produces a commit whose bytes
   are already formatted (`git show HEAD:<file>` is clean); no working-tree remnant.
   _ADR_: [025-formatting-gate-belt-and-suspenders.md](../adrs/025-formatting-gate-belt-and-suspenders.md)

3. **Read-only `pre-push` check restored.**
   `.husky/pre-push` runs `pnpm format:check` (`prettier --check .`) — identical to the CI
   Format job. Read-only: it never writes, so it can never reintroduce a re-stage bug.
   _Acceptance_: a file committed unformatted via `--no-verify` is blocked at `git push`
   with the same failure CI would report.

4. **Pinned editor formatting.**
   Committed `.vscode/settings.json` (`editor.formatOnSave: true`,
   `editor.defaultFormatter: esbenp.prettier-vscode`,
   `prettier.prettierPath: node_modules/prettier`) and `.vscode/extensions.json`
   recommending the Prettier extension.
   _Acceptance_: on-save formatting uses the repo's pinned Prettier version (no version-skew
   tug-of-war where the editor and lint-staged disagree).

### Nice-to-Have (P1)

5. **Doc update in `docs/runbooks/pr-workflow.md`** describing the four layers and the
   `--no-verify` → CI-backstop escape hatch, so the runbook matches reality post-change.

### Future Considerations (P2)

6. Revisit lint-staged scope if a non-Prettier formatter (e.g. ESLint `--fix`) is ever added
   to the commit path.

---

## Decisions Made

| Question                               | Decision                                    | Rationale                                                                                                                           |
| -------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Patch the hook vs. re-architect        | Re-architect (belt-and-suspenders)          | A `git add` patch keeps the fragile mutate-at-commit model; the goal is to remove the bug class                                     |
| lint-staged now? (ADR-006 deferred it) | Yes                                         | ADR-006 deferred it _for repo size_; we adopt it for **correctness** — it re-stages by design, unlike whole-repo `prettier --write` |
| Where fixing happens                   | Editor + commit only; push/CI are read-only | Separating "fix" from "gate" makes the re-stage bug unreachable at the gates                                                        |
| CRLF handling                          | `.gitattributes eol=lf`, landed first       | The only way the local `--check` can match Linux CI byte-for-byte                                                                   |

---

## Success Metrics

| Metric                                               | Target | Window  |
| ---------------------------------------------------- | ------ | ------- |
| Format CI failures per PR                            | 0      | Ongoing |
| Manual "commit the prettier fixes" follow-up commits | 0      | Ongoing |
| CRLF-driven `format:check` false-fails locally       | 0      | Ongoing |

---

## Verification Plan

1. **Re-stage fix**: unformatted file → `git add` → `git commit` → `git show HEAD:<file>`
   is formatted; working tree clean.
2. **Commit-bypass caught**: `git commit --no-verify` an unformatted file → `git push` is
   blocked by pre-push `format:check`.
3. **CRLF parity**: on the Windows working tree, `pnpm format:check` passes (no line-ending
   failures) after the `.gitattributes` renormalization commit.
4. **Editor parity**: format-on-save output equals `pnpm format` output (same binary/version).
