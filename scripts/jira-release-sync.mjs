#!/usr/bin/env node
// Jira release sync — after a prod promote succeeds (promote.yml), move every
// Jira ticket referenced in the release's commits to Done (ADR-022).
//
// Truth source for "what shipped" is the GitHub Release notes that
// release-please generated for this tag: its CHANGELOG body carries each commit
// subject, and our subjects carry the Jira key, e.g. "... (BOOKSHELF-69) (#92)".
//
// The Jira REST plumbing (idempotent transition + soft-fail) lives in
// ./lib/jira-sync.mjs, shared with jira-dev-sync.mjs (ADR-024). Dependency-free
// (Node 22 global fetch). Talks only to the GitHub REST API (read the release) and
// the Jira REST API (transition issues) — no AWS, no gh CLI. SOFT-FAILS by design:
// a Jira outage or a misconfigured secret logs a GitHub `::warning::` and exits 0,
// so it never red-builds a prod deploy that already succeeded and smoke-passed.
//
// Env:
//   RELEASE_TAG        required — e.g. "v1.2.3"
//   GITHUB_REPOSITORY  required — "owner/repo" (provided by Actions)
//   GH_TOKEN           required — read the release (github.token is enough)
//   JIRA_BASE_URL      required — e.g. "https://your-site.atlassian.net"
//   JIRA_USER_EMAIL    required — Atlassian account email for the API token
//   JIRA_API_TOKEN     required — Atlassian API token
//   JIRA_KEY_PREFIX    optional — issue-key project prefix (default "BOOKSHELF")
//   JIRA_TARGET_STATUS optional — status to move issues to (default "Done")
//   DRY_RUN            optional — "true" to validate + log without POSTing the
//                      transition (for local pre-flight checks; no tickets move)

import { makeLog, extractKeys, makeJiraClient, syncKeys } from "./lib/jira-sync.mjs";

const log = makeLog();
const { warn, info } = log;

const {
  RELEASE_TAG,
  GITHUB_REPOSITORY,
  GH_TOKEN,
  JIRA_BASE_URL,
  JIRA_USER_EMAIL,
  JIRA_API_TOKEN,
  JIRA_KEY_PREFIX = "BOOKSHELF",
  JIRA_TARGET_STATUS = "Done",
  DRY_RUN,
} = process.env;

const dryRun = DRY_RUN === "true";

// Never fail the promote: any missing config is a warning + clean exit.
function bailSoft(msg) {
  warn(msg);
  process.exit(0);
}

const missing = Object.entries({
  RELEASE_TAG,
  GITHUB_REPOSITORY,
  GH_TOKEN,
  JIRA_BASE_URL,
  JIRA_USER_EMAIL,
  JIRA_API_TOKEN,
})
  .filter(([, v]) => !v)
  .map(([k]) => k);
if (missing.length) bailSoft(`missing required env: ${missing.join(", ")} — skipping Jira sync`);

async function getReleaseBody() {
  const url = `https://api.github.com/repos/${GITHUB_REPOSITORY}/releases/tags/${encodeURIComponent(RELEASE_TAG)}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${GH_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok)
    throw new Error(
      `GitHub release lookup for ${RELEASE_TAG} failed: ${res.status} ${res.statusText}`,
    );
  const json = await res.json();
  return json.body ?? "";
}

async function main() {
  let body;
  try {
    body = await getReleaseBody();
  } catch (err) {
    return bailSoft(`${err.message} — skipping Jira sync`);
  }

  const keys = extractKeys(body, JIRA_KEY_PREFIX);
  if (keys.length === 0) {
    info(`no ${JIRA_KEY_PREFIX}-* keys in ${RELEASE_TAG} release notes — nothing to sync`);
    return;
  }
  info(
    `${dryRun ? "[dry-run] " : ""}syncing ${keys.length} ticket(s) for ${RELEASE_TAG}: ${keys.join(", ")}`,
  );

  const client = makeJiraClient({
    baseUrl: JIRA_BASE_URL,
    email: JIRA_USER_EMAIL,
    token: JIRA_API_TOKEN,
  });
  await syncKeys({
    keys,
    targetStatus: JIRA_TARGET_STATUS,
    client,
    dryRun,
    log,
    context: RELEASE_TAG,
  });
  info("Jira sync complete");
}

main().catch((err) => bailSoft(`unexpected error: ${err.message}`));
