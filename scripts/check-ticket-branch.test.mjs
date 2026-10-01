import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { commandDir } from "./check-ticket-branch.mjs";

const SCRIPT = fileURLToPath(new URL("./check-ticket-branch.mjs", import.meta.url));
const CWD = resolve("/work/bookshelf");

test("commandDir falls back to the session cwd", () => {
  assert.equal(commandDir("git commit -m x && git push", CWD), CWD);
});

test("commandDir follows a leading cd or Set-Location", () => {
  assert.equal(commandDir("cd /other/repo && git push", CWD, "linux"), resolve("/other/repo"));
  assert.equal(
    commandDir('Set-Location "C:\\other repo"; git push', CWD, "win32"),
    resolve(CWD, "C:\\other repo"),
  );
  assert.equal(
    commandDir("git status; cd ../sibling && git commit -m x", CWD, "linux"),
    resolve(CWD, "../sibling"),
  );
});

test("commandDir prefers git -C over cd", () => {
  assert.equal(commandDir("cd /a && git -C '/b c' commit -m x", CWD, "linux"), resolve("/b c"));
});

test("commandDir maps Git Bash drive paths on Windows only", () => {
  assert.equal(commandDir("cd /g/source/x && git push", CWD, "win32"), resolve(CWD, "G:/source/x"));
  assert.equal(commandDir("cd /g/source/x && git push", CWD, "linux"), resolve("/g/source/x"));
});

test("a keyless worktree branch in another repo is not blocked", () => {
  const root = mkdtempSync(join(tmpdir(), "ticket-guard-"));
  try {
    const repo = join(root, ".claude", "worktrees", "other");
    mkdirSync(repo, { recursive: true });
    const git = (...args) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });
    git("init", "-q", "-b", "claude/keyless");
    git(
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "init",
    );
    const payload = { tool_input: { command: "git push" }, cwd: repo };
    const env = { ...process.env };
    delete env.BRANCH_GUARD_BYPASS;
    const r = spawnSync(process.execPath, [SCRIPT], {
      input: JSON.stringify(payload),
      env,
      encoding: "utf8",
    });
    assert.equal(r.status, 0, r.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
