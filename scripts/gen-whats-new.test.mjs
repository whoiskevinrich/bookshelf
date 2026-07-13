import { test } from "node:test";
import assert from "node:assert/strict";
import { extractEntries, mergeEntries } from "./gen-whats-new.mjs";

test("extractEntries pulls a single Release-Note trailer", () => {
  const commits = [
    { sha: "abc1234567", date: "2026-07-01", body: "feat: x\n\nRelease-Note: Do the thing." },
  ];
  assert.deepEqual(extractEntries(commits), [
    { id: "abc1234", date: "2026-07-01", note: "Do the thing." },
  ]);
});

test("extractEntries yields nothing for a commit without a trailer", () => {
  const commits = [{ sha: "abc1234567", date: "2026-07-01", body: "chore: tidy up" }];
  assert.deepEqual(extractEntries(commits), []);
});

test("extractEntries emits one entry per trailer, suffixing the id", () => {
  const commits = [
    {
      sha: "abc1234567",
      date: "2026-07-01",
      body: "feat: x\n\nRelease-Note: First.\nRelease-Note: Second.",
    },
  ];
  assert.deepEqual(extractEntries(commits), [
    { id: "abc1234-1", date: "2026-07-01", note: "First." },
    { id: "abc1234-2", date: "2026-07-01", note: "Second." },
  ]);
});

test("mergeEntries combines seed and derived entries, newest first", () => {
  const derived = [{ id: "d1", date: "2026-07-10", note: "derived" }];
  const seed = [{ id: "s1", date: "2026-07-02", note: "seed" }];
  assert.deepEqual(mergeEntries(derived, seed), [
    { id: "d1", date: "2026-07-10", note: "derived" },
    { id: "s1", date: "2026-07-02", note: "seed" },
  ]);
});

test("mergeEntries de-dupes by id, preferring the derived entry", () => {
  const derived = [{ id: "shared", date: "2026-07-10", note: "from trailer" }];
  const seed = [{ id: "shared", date: "2026-07-02", note: "from seed" }];
  assert.deepEqual(mergeEntries(derived, seed), [
    { id: "shared", date: "2026-07-10", note: "from trailer" },
  ]);
});
