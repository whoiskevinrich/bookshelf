#!/usr/bin/env node
// Generate apps/web/public/whats-new.json — the in-app "What's New" feed.
//
// Re-derives the ENTIRE feed from git history on every run: extracts
// `Release-Note:` trailers from commit messages into a reverse-chronological,
// date-grouped list. Dependency-free and a pure function of git history, so the
// output is deterministic (byte-identical for identical history — no wall-clock
// timestamps). Wired ahead of `vite build` (and `vite` dev) in apps/web.
//
// See docs/specs/whats-new.md (BOOKSHELF-74). No backend: the JSON ships as a
// static asset the SPA fetches at /whats-new.json.
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const RECORD_SEP = "\x1e"; // between commits
const UNIT_SEP = "\x1f"; // between fields within a commit
// Permissive by design (spec Q3): case-insensitive key, tolerant of surrounding
// whitespace. The captured value is the sentence shown in the feed.
const TRAILER_RE = /^Release-Note:[ \t]*(.+?)[ \t]*$/i;

function git(args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

// %H full sha, %ad author date (YYYY-MM-DD via --date=short), %B raw body.
function readCommits() {
  const fmt = ["%H", "%ad", "%B"].join(UNIT_SEP) + RECORD_SEP;
  const out = git(["log", "--no-merges", "--date=short", `--pretty=format:${fmt}`]);
  return out
    .split(RECORD_SEP)
    .map((record) => record.replace(/^\n/, "")) // strip the newline git inserts between records
    .filter((record) => record.trim() !== "")
    .map((record) => {
      const [sha, date, body = ""] = record.split(UNIT_SEP);
      return { sha: sha.trim(), date: date.trim(), body };
    });
}

// commits: [{ sha, date, body }] newest-first → entries newest-first.
// A commit with no trailer yields nothing; multiple trailers yield multiple
// entries. Exported for testing.
export function extractEntries(commits) {
  const entries = [];
  for (const { sha, date, body } of commits) {
    const notes = body
      .split(/\r?\n/)
      .map((line) => line.match(TRAILER_RE))
      .filter((match) => match !== null)
      .map((match) => match[1].trim())
      .filter((note) => note.length > 0);

    const shortSha = sha.slice(0, 7);
    notes.forEach((note, index) => {
      // Stable, unique id for the panel's seen-tracking. Bare short SHA in the
      // common (single-note) case; suffixed only when one commit has several.
      const id = notes.length === 1 ? shortSha : `${shortSha}-${index + 1}`;
      entries.push({ id, date, note });
    });
  }
  return entries;
}

function main() {
  let commits = [];
  try {
    commits = readCommits();
  } catch (error) {
    // Never break the web build if git history is unavailable (e.g. a shallow
    // CI checkout). Emit an empty feed; the panel handles it gracefully.
    console.warn(`[gen-whats-new] git history unavailable — writing empty feed: ${error.message}`);
  }

  let root;
  try {
    root = git(["rev-parse", "--show-toplevel"]).trim();
  } catch {
    // Fall back to two levels up from this script (repo/scripts/gen-whats-new.mjs).
    root = join(dirname(fileURLToPath(import.meta.url)), "..");
  }

  const entries = extractEntries(commits);
  // Derived from history (newest entry's date), never the wall clock, so the
  // file is byte-identical across runs on the same history.
  const generatedAt = entries[0]?.date ?? commits[0]?.date ?? null;

  const outPath = join(root, "apps", "web", "public", "whats-new.json");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify({ generatedAt, entries }, null, 2) + "\n");

  const noun = entries.length === 1 ? "entry" : "entries";
  console.log(`[gen-whats-new] wrote ${entries.length} ${noun} → ${outPath}`);
}

// Only run when invoked directly, so tests can import extractEntries cleanly.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
