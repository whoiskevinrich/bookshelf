import { test } from "node:test";
import assert from "node:assert/strict";
import { extractKeys, selectTransitionId } from "./jira-sync.mjs";

test("extractKeys pulls the key from a squash-commit subject", () => {
  assert.deepEqual(extractKeys("feat(web): What's New panel (BOOKSHELF-75) (#103)"), [
    "BOOKSHELF-75",
  ]);
});

test("extractKeys dedups and upper-cases", () => {
  assert.deepEqual(extractKeys("fix bookshelf-4, BOOKSHELF-4 and BOOKSHELF-56"), [
    "BOOKSHELF-4",
    "BOOKSHELF-56",
  ]);
});

test("extractKeys returns [] when no key is present", () => {
  assert.deepEqual(extractKeys("chore: tidy up"), []);
});

test("extractKeys tolerates null/undefined", () => {
  assert.deepEqual(extractKeys(null), []);
  assert.deepEqual(extractKeys(undefined), []);
});

test("extractKeys honours a custom prefix and ignores others", () => {
  assert.deepEqual(extractKeys("HOLODEX-128 and BOOKSHELF-1", "HOLODEX"), ["HOLODEX-128"]);
  assert.deepEqual(extractKeys("HOLODEX-128"), []); // default prefix is BOOKSHELF
});

test("selectTransitionId matches on destination status, case-insensitive", () => {
  const transitions = [
    { id: "11", to: { name: "To Do" } },
    { id: "31", to: { name: "On Dev" } },
  ];
  assert.equal(selectTransitionId(transitions, "on dev"), "31");
});

test("selectTransitionId returns null when no transition reaches the target", () => {
  assert.equal(selectTransitionId([{ id: "11", to: { name: "To Do" } }], "Done"), null);
});

test("selectTransitionId tolerates missing/empty input", () => {
  assert.equal(selectTransitionId(undefined, "Done"), null);
  assert.equal(selectTransitionId([], "Done"), null);
});
