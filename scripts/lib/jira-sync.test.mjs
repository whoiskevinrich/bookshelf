import { test } from "node:test";
import assert from "node:assert/strict";
import { extractKeys, makeJiraClient, selectTransition, syncKeys } from "./jira-sync.mjs";

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

// Fake client: one issue at `from`; every target status is reachable. `category` /
// `toCategory` override the current / destination status category.
function fakeClient(from, target, opts) {
  const calls = [];
  const category = "category" in opts ? opts.category : CATEGORY[from];
  const toCategory = "toCategory" in opts ? opts.toCategory : CATEGORY[target];
  return {
    calls,
    async currentStatus() {
      return { status: from, category };
    },
    async findTransition() {
      return { id: "99", category: toCategory };
    },
    async transition(key, id) {
      calls.push({ key, id });
    },
  };
}

function captureLog() {
  const warnings = [];
  const infos = [];
  return { warnings, infos, warn: (m) => warnings.push(m), info: (m) => infos.push(m) };
}

async function run(from, targetStatus, { dryRun = false, ...opts } = {}) {
  const client = fakeClient(from, targetStatus, opts);
  const log = captureLog();
  const failures = await syncKeys({ keys: ["BOOKSHELF-1"], targetStatus, client, dryRun, log });
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
  const { client, log, failures } = await run("Won't Do", "On Dev");
  assert.equal(failures, 0);
  assert.equal(client.calls.length, 0);
  assert.equal(log.warnings.length, 1);
  assert.match(log.warnings[0], /"Won't Do" → "On Dev"/);
});

test("syncKeys refuses a backward move in dry-run too (never 'would transition')", async () => {
  const { client, log } = await run("Done", "On Dev", { dryRun: true });
  assert.equal(client.calls.length, 0);
  assert.match(log.warnings[0], /never moves an issue backwards/);
  assert.ok(!log.infos.some((m) => /would transition/.test(m)));
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

test("syncKeys lets an unranked status category through, either side", async () => {
  for (const opts of [{ category: "undefined" }, { toCategory: "undefined" }]) {
    const { client, log } = await run("Done", "On Dev", opts);
    assert.equal(client.calls.length, 1);
    assert.deepEqual(log.warnings, []);
  }
});

test("syncKeys warns (but still transitions) when Jira omits a status category", async () => {
  for (const opts of [{ category: undefined }, { toCategory: undefined }]) {
    const { client, log } = await run("Done", "On Dev", opts);
    assert.equal(client.calls.length, 1);
    assert.match(log.warnings[0], /status category missing/);
  }
});

// End-to-end through the real client with a stubbed fetch: pins that currentStatus /
// findTransition actually read statusCategory.key off Jira's responses. Without
// this, a wrong path there would silently disable the guard.
test("syncKeys + makeJiraClient refuses Done → On Dev from real Jira response shapes", async (t) => {
  const posts = [];
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    if (init.method === "POST") posts.push(url);
    const body = url.includes("/transitions")
      ? {
          transitions: [
            { id: "31", to: { name: "On Dev", statusCategory: { key: "indeterminate" } } },
          ],
        }
      : { fields: { status: { name: "Done", statusCategory: { key: "done" } } } };
    return { ok: true, status: 200, json: async () => body };
  });
  const client = makeJiraClient({ baseUrl: "https://jira.test", email: "e", token: "t" });
  const log = captureLog();
  await syncKeys({ keys: ["BOOKSHELF-1"], targetStatus: "On Dev", client, log });
  assert.deepEqual(posts, []);
  assert.match(log.warnings[0], /"Done" → "On Dev"/);
});
