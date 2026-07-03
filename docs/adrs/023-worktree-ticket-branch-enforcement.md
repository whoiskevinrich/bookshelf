# ADR-023: Enforce a Jira-Keyed Branch Name in Worktree Sessions

**Status**: Accepted
**Date**: 2026-07-02
**Builds on**: [ADR-022](022-jira-release-sync.md) (Jira release sync). Enforces the precondition that makes the sync's coverage reliable.

## Context

ADR-022 closes the loop from a release back to Jira by scraping `BOOKSHELF-\d+` keys out of the release notes — which are built from squash-merge commit subjects (PR titles). That only works if the key is actually **in** the PR title, and across a recent sample only 1 of 4 merged PRs carried one. Coverage was therefore a matter of discipline, not construction.

New Claude Code worktrees start on an **auto-generated branch** (e.g. `claude/amazing-heisenberg-f8b2f8`) with no ticket reference at all. If the branch carried the key from the start, it could flow deterministically: **branch → PR title → squash subject → release notes → Jira sync.** The branch name is the earliest, cheapest place to pin the ticket.

## Decision

**A worktree session must be on a branch containing a `BOOKSHELF-<n>` key; commits, pushes, and PR creation are blocked until it is.** Implemented as two Claude Code hooks in the version-controlled `.claude/settings.json` (so every worktree inherits them):

1. **SessionStart nudge (non-blocking).** On startup in a `.claude/worktrees/` path, if the branch has no key (and isn't `main`/`master`), print an instruction telling the agent to confirm the ticket with the user and rename via `git branch -m <auto> BOOKSHELF-<n>-<slug>` before doing implementation work.
2. **PreToolUse gate (blocking).** Before `git commit` / `git push` / `gh pr create`, run `scripts/check-ticket-branch.mjs`. It reads the command from the hook payload, and if the session is in a worktree on a keyless branch, exits **2** to block the tool call and surface the rename instruction. Registered under **both** the `Bash` and `PowerShell` tool matchers, because commits happen via either tool (PowerShell is mandated for multi-line messages) — a single-matcher gate would fail open.

### Scope and escape hatch

- **Only worktree sessions** (`cwd` under `.claude/worktrees/`) are governed; `main`/`master` and non-git contexts are never blocked.
- **`BRANCH_GUARD_BYPASS=1`** in the hook environment overrides the gate for genuinely ticketless work — the documented emergency valve (analogous to `--no-verify`).

### Why Claude hooks, not a husky git hook

A husky `pre-commit`/`pre-push` would be tool-agnostic and catch the user's own terminal too — but it activates instantly and would **deadlock the very commit that introduces it** on a pre-rule keyless branch. The Claude-hook gate governs the agent (the actual actor in this workflow) and is the layer the user asked for ("gate + session-start nudge"). A husky backstop for manual-terminal commits is a possible follow-on, adopted from a keyed branch to avoid the bootstrap deadlock.

## Alternatives considered

- **Convention only** (put the key in the PR title by hand). That's the status quo whose 1-in-4 hit rate motivated this. Rejected.
- **Broaden the sync's key source** (scan commit bodies / the PR compare range, not just the title). Complementary, not a substitute — still relies on the key being written *somewhere*; the branch is the most reliable somewhere. Kept as an option.
- **Auto-rename at session start.** Can't — the ticket number isn't derivable without human input. Hence detect-and-require, not auto-fix.
- **Loosest rule** (any non-`claude/*` name). Stops random names but doesn't guarantee a key reaches the release. Rejected in favour of requiring `BOOKSHELF-<n>`.

## Consequences

**Good**

- The Jira key is pinned at the earliest point and flows deterministically into ADR-022's sync — coverage by construction, not discipline.
- Can't accidentally ship work on an anonymous `claude/*` branch; the gate is tool-agnostic across Bash and PowerShell.

**Trade-offs**

- **Bootstrap deadlock**: the gate blocks commits on keyless branches, including the branch introducing it and any pre-existing worktree session (like the one that authored this ADR). Handled via the `BRANCH_GUARD_BYPASS` valve for the one-time landing; thereafter every new worktree is renamed up front.
- Requires a Jira ticket to exist before implementation can be committed — intended, but it front-loads ticket creation for spikes (use the bypass or a throwaway key).
- Relies on the `if: <Tool>(git*)` PreToolUse matcher DSL for both tool matchers; if the PowerShell-matcher form ever changes, the script still self-checks the command from stdin, but the entry must fire to run at all.
