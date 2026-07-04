#!/usr/bin/env node
// Jira dev sync — after a dev deploy succeeds AND smoke passes (deploy.yml), move
// every Jira ticket referenced in the merge commit to "On dev" (ADR-024). This is
// the human-QA queue: a saved filter `status = "On dev"` = "what needs QA".
//
// Key source is the merge/squash commit subject (COMMIT_MESSAGE) — the same keys
// jira-release-sync.mjs reads from the release notes at prod time (e.g.
// "... (BOOKSHELF-75) (#103)"). Shares the idempotent + soft-fail plumbing in
// ./lib/jira-sync.mjs. Dependency-free (Node 22 global fetch); talks only to Jira.
//
// SOFT-FAILS by design: a Jira outage, a missing key, or an unreachable transition
// logs a GitHub `::warning::` and exits 0, so it never red-builds a dev deploy that
// already succeeded and smoke-passed. Until the "On dev" status exists in Jira
// (BOOKSHELF-80), every key simply no-ops with a warning — safe to ship first.
//
// Env:
//   COMMIT_MESSAGE     required — the merge/squash commit message (subject + body)
//   JIRA_BASE_URL      required — e.g. "https://your-site.atlassian.net"
//   JIRA_USER_EMAIL    required — Atlassian account email for the API token
//   JIRA_API_TOKEN     required — Atlassian API token
//   JIRA_KEY_PREFIX    optional — issue-key project prefix (default "BOOKSHELF")
//   JIRA_TARGET_STATUS optional — status to move issues to (default "On dev")
//   DRY_RUN            optional — "true" to validate + log without POSTing

import { makeLog, extractKeys, makeJiraClient, syncKeys } from "./lib/jira-sync.mjs";

const log = makeLog("jira-dev-sync");
const { warn, info } = log;

const {
  COMMIT_MESSAGE,
  JIRA_BASE_URL,
  JIRA_USER_EMAIL,
  JIRA_API_TOKEN,
  JIRA_KEY_PREFIX = "BOOKSHELF",
  JIRA_TARGET_STATUS = "On dev",
  DRY_RUN,
} = process.env;

const dryRun = DRY_RUN === "true";

// Never fail the deploy: any missing config is a warning + clean exit.
function bailSoft(msg) {
  warn(msg);
  process.exit(0);
}

const missing = Object.entries({
  COMMIT_MESSAGE,
  JIRA_BASE_URL,
  JIRA_USER_EMAIL,
  JIRA_API_TOKEN,
})
  .filter(([, v]) => !v)
  .map(([k]) => k);
if (missing.length) bailSoft(`missing required env: ${missing.join(", ")} — skipping Jira sync`);

async function main() {
  const keys = extractKeys(COMMIT_MESSAGE, JIRA_KEY_PREFIX);
  if (keys.length === 0) {
    info(`no ${JIRA_KEY_PREFIX}-* keys in commit message — nothing to sync`);
    return;
  }
  info(
    `${dryRun ? "[dry-run] " : ""}syncing ${keys.length} ticket(s) → "${JIRA_TARGET_STATUS}": ${keys.join(", ")}`,
  );

  const client = makeJiraClient({
    baseUrl: JIRA_BASE_URL,
    email: JIRA_USER_EMAIL,
    token: JIRA_API_TOKEN,
  });
  await syncKeys({ keys, targetStatus: JIRA_TARGET_STATUS, client, dryRun, log });
  info("Jira sync complete");
}

main().catch((err) => bailSoft(`unexpected error: ${err.message}`));
