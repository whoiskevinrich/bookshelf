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
// Scope: only commands that act on a Bookshelf worktree (path under
// .claude/worktrees/). The directory is the one the command targets — a leading
// `cd`/`Set-Location` or `git -C` — not just the session's cwd, so a session
// working in another repo isn't blocked on Bookshelf's branch. Never blocks
// main/master or a non-git context. Escape hatch: BRANCH_GUARD_BYPASS=1 in the
// hook's environment (a command-line prefix doesn't reach it — deliberately, so
// the agent can't self-disarm the gate; see ADR-023).
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const KEY_RE = /BOOKSHELF-\d+/i;
// Match the artifact-producing commands anywhere in a (possibly compound) command.
const GUARDED_RE = /(^|[;&|]|\s)(git\s+commit|git\s+push|gh\s+pr\s+create)\b/;
const ARG = String.raw`("[^"]+"|'[^']+'|\S+)`;
const GIT_C_RE = new RegExp(String.raw`\bgit\s+-C\s+${ARG}`);
const CD_RE = new RegExp(
  String.raw`(?:^|[;&|]|\n)\s*(?:cd|pushd|Set-Location|sl)\s+(?:-(?:Literal)?Path\s+)?${ARG}`,
  "i",
);

/**
 * The directory a command acts on: `git -C <dir>` wins, else the first
 * `cd`/`pushd`/`Set-Location <dir>`, else `cwd`. Git Bash drive paths
 * (`/g/source/x`) are mapped to `G:/source/x` on Windows.
 */
export function commandDir(command, cwd, platform = process.platform) {
  const m = command.match(GIT_C_RE) ?? command.match(CD_RE);
  if (!m) return cwd;
  let dir = m[1].replace(/^["']|["']$/g, "");
  if (platform === "win32")
    dir = dir.replace(/^\/([a-z])(\/|$)/i, (_, d) => `${d.toUpperCase()}:/`);
  return resolve(cwd, dir);
}

function git(args, cwd) {
  return execFileSync("git", args, {
    encoding: "utf8",
    cwd,
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

const commonDir = (cwd) =>
  git(["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd)
    .replace(/\\/g, "/")
    .toLowerCase();

function main() {
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

  const cwd = commandDir(command, payload?.cwd ?? process.cwd());
  if (!cwd.replace(/\\/g, "/").includes("/.claude/worktrees/")) allow();

  let branch = "";
  try {
    // Another repo's branch is not Bookshelf's business.
    const home = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    if (commonDir(cwd) !== commonDir(home)) allow();
    branch = git(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
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
      `Genuinely ticketless work: the user sets BRANCH_GUARD_BYPASS=1 in the hook's environment ` +
      `(a command-line prefix doesn't reach the hook).\n`,
  );
  process.exit(2);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
