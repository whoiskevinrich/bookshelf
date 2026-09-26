import { test } from "node:test";
import assert from "node:assert/strict";
import { extractKeys, selectTransition, syncKeys } from "./jira-sync.mjs";

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

test("selectTransition matches on destination status, case-insensitive", () => {
  const transitions = [
    { id: "11", to: { name: "To Do", statusCategory: { key: "new" } } },
    { id: "31", to: { name: "On Dev", statusCategory: { key: "indeterminate" } } },
  ];
  assert.deepEqual(selectTransition(transitions, "on dev"), {
    id: "31",
    category: "indeterminate",
  });
});

test("selectTransition returns null when no transition reaches the target", () => {
  assert.equal(selectTransition([{ id: "11", to: { name: "To Do" } }], "Done"), null);
});

test("selectTransition tolerates missing/empty input", () => {
  assert.equal(selectTransition(undefined, "Done"), null);
  assert.equal(selectTransition([], "Done"), null);
});

// --- syncKeys: forward-only rule -------------------------------------------

const CATEGORY = {
  "To Do": "new",
  "In Progress": "indeterminate",
  "In Review": "indeterminate",
  "On Dev": "indeterminate",
  "Ready for release": "indeterminate",
  Done: "done",
  "Won't Do": "done",
};

// Fake client: one issue at `from`; every target status is reachable.
function fakeClient(from, { category = CATEGORY[from] } = {}) {
  const calls = [];
  return {
    calls,
    async currentStatus() {
      return { status: from, category };
    },
    async findTransition(_key, target) {
      return { id: "99", category: CATEGORY[target] };
    },
    async transition(key, id) {
      calls.push({ key, id });
    },
  };
}

function captureLog() {
  const warnings = [];
  return { warnings, warn: (m) => warnings.push(m), info: () => {} };
}

async function run(from, targetStatus, opts) {
  const client = fakeClient(from, opts);
  const log = captureLog();
  const failures = await syncKeys({ keys: ["BOOKSHELF-1"], targetStatus, client, log });
  return { client, log, failures };
}

test("syncKeys refuses Done → On Dev and warns naming both statuses", async () => {
  const { client, log, failures } = await run("Done", "On Dev");
  assert.equal(failures, 0);
  assert.equal(client.calls.length, 0);
  assert.equal(log.warnings.length, 1);
  assert.match(log.warnings[0], /"Done" → "On Dev"/);
  assert.match(log.warnings[0], /never moves an issue backwards/);
});

test("syncKeys refuses Won't Do → On Dev", async () => {
  const { client, log } = await run("Won't Do", "On Dev");
  assert.equal(client.calls.length, 0);
  assert.match(log.warnings[0], /"Won't Do" → "On Dev"/);
});

for (const [from, to] of [
  ["On Dev", "Done"],
  ["Ready for release", "Done"],
  ["In Review", "On Dev"], // sideways within indeterminate
]) {
  test(`syncKeys still transitions ${from} → ${to}`, async () => {
    const { client, log } = await run(from, to);
    assert.deepEqual(client.calls, [{ key: "BOOKSHELF-1", id: "99" }]);
    assert.deepEqual(log.warnings, []);
  });
}

test("syncKeys lets an unranked status category through", async () => {
  const { client } = await run("Triage", "On Dev", { category: "undefined" });
  assert.equal(client.calls.length, 1);
});
