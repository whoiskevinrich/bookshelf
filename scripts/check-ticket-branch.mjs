#!/usr/bin/env node
// PreToolUse gate (ADR-023): refuse to commit / push / open a PR from a worktree
// branch that has no Jira key, so the key flows branch → PR title → squash
// subject → release notes → Jira sync (ADR-022).
//
// Registered under BOTH the Bash and PowerShell tool matchers — you commit via
// either — and reads the actual command from the PreToolUse payload on stdin, so
// it is tool-agnostic. Exit 2 blocks the tool call and surfaces stderr to Claude;
// exit 0 allows it.
//
// Scope: only worktree sessions (path under .claude/worktrees/); never blocks
// main/master or a non-git context. Escape hatch: set BRANCH_GUARD_BYPASS=1 to
// allow a keyless branch through (documented emergency valve, like --no-verify).
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const KEY_RE = /BOOKSHELF-\d+/i;
// Match the artifact-producing commands anywhere in a (possibly compound) command.
const GUARDED_RE = /(^|[;&|]|\s)(git\s+commit|git\s+push|gh\s+pr\s+create)\b/;

const allow = () => process.exit(0);

if (process.env.BRANCH_GUARD_BYPASS === "1") allow();

// PreToolUse payload: { tool_input: { command }, cwd, ... }. Be defensive — a
// parse failure must fail OPEN (never wedge the session over a gate bug).
let payload = {};
try {
  payload = JSON.parse(readFileSync(0, "utf8"));
} catch {
  allow();
}

const command = payload?.tool_input?.command ?? "";
if (!GUARDED_RE.test(command)) allow();

const cwd = payload?.cwd ?? process.cwd();
if (!cwd.replace(/\\/g, "/").includes("/.claude/worktrees/")) allow();

let branch = "";
try {
  branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    encoding: "utf8",
    cwd,
  }).trim();
} catch {
  allow(); // not a git context — don't block
}

if (["main", "master", "HEAD", ""].includes(branch)) allow();
if (KEY_RE.test(branch)) allow();

process.stderr.write(
  `[require-ticket-branch] Branch "${branch}" has no Jira key — blocked.\n` +
    `Rename it to include its BOOKSHELF ticket first, e.g.:\n` +
    `    git branch -m ${branch} BOOKSHELF-<n>-<slug>\n` +
    `Then retry. Enforced (ADR-023) so the key reaches the release notes → Jira sync (ADR-022).\n` +
    `Genuinely ticketless work: prefix BRANCH_GUARD_BYPASS=1 to override.\n`,
);
process.exit(2);
