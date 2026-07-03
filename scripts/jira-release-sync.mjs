#!/usr/bin/env node
// Jira release sync — after a prod promote succeeds (promote.yml), move every
// Jira ticket referenced in the release's commits to Done (ADR-022).
//
// Truth source for "what shipped" is the GitHub Release notes that
// release-please generated for this tag: its CHANGELOG body carries each commit
// subject, and our subjects carry the Jira key, e.g. "... (BOOKSHELF-69) (#92)".
//
// Dependency-free (Node 22 global fetch). Talks only to the GitHub REST API
// (read the release) and the Jira REST API (transition issues) — no AWS, no gh
// CLI. SOFT-FAILS by design: a Jira outage or a misconfigured secret logs a
// GitHub `::warning::` and exits 0, so it never red-builds a prod deploy that
// already succeeded and smoke-passed.
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

const warn = (msg) => console.log(`::warning::[jira-sync] ${msg}`);
const info = (msg) => console.log(`[jira-sync] ${msg}`);

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

const jiraBase = JIRA_BASE_URL.replace(/\/+$/, "");
const jiraAuth = "Basic " + Buffer.from(`${JIRA_USER_EMAIL}:${JIRA_API_TOKEN}`).toString("base64");
const jiraHeaders = {
  Authorization: jiraAuth,
  Accept: "application/json",
  "Content-Type": "application/json",
};

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

function extractKeys(body) {
  const re = new RegExp(`\\b${JIRA_KEY_PREFIX}-\\d+\\b`, "gi");
  const keys = new Set();
  for (const m of body.matchAll(re)) keys.add(m[0].toUpperCase());
  return [...keys];
}

async function currentStatus(key) {
  const res = await fetch(`${jiraBase}/rest/api/3/issue/${key}?fields=status`, {
    headers: jiraHeaders,
  });
  if (res.status === 404) return { missing: true };
  if (!res.ok) throw new Error(`GET issue ${key} failed: ${res.status} ${res.statusText}`);
  const json = await res.json();
  return { status: json.fields?.status?.name ?? null };
}

async function findTransitionId(key) {
  const res = await fetch(`${jiraBase}/rest/api/3/issue/${key}/transitions`, {
    headers: jiraHeaders,
  });
  if (!res.ok)
    throw new Error(`GET transitions for ${key} failed: ${res.status} ${res.statusText}`);
  const json = await res.json();
  const target = JIRA_TARGET_STATUS.toLowerCase();
  // Match on the transition's destination status name (robust to transition
  // naming like "Done" vs "Mark as Done").
  const t = (json.transitions ?? []).find((tr) => tr.to?.name?.toLowerCase() === target);
  return t?.id ?? null;
}

async function transition(key, transitionId) {
  const res = await fetch(`${jiraBase}/rest/api/3/issue/${key}/transitions`, {
    method: "POST",
    headers: jiraHeaders,
    body: JSON.stringify({ transition: { id: transitionId } }),
  });
  if (!res.ok)
    throw new Error(
      `POST transition ${transitionId} on ${key} failed: ${res.status} ${res.statusText}`,
    );
}

async function syncOne(key) {
  const cur = await currentStatus(key);
  if (cur.missing) return warn(`${key}: not found in Jira — skipping`);
  if (cur.status?.toLowerCase() === JIRA_TARGET_STATUS.toLowerCase()) {
    return info(`${key}: already "${JIRA_TARGET_STATUS}" — no-op`);
  }
  const id = await findTransitionId(key);
  if (!id) {
    return warn(
      `${key}: no transition to "${JIRA_TARGET_STATUS}" available from "${cur.status}" — skipping`,
    );
  }
  if (dryRun) {
    return info(
      `${key}: [dry-run] would transition "${cur.status}" → "${JIRA_TARGET_STATUS}" (id ${id})`,
    );
  }
  await transition(key, id);
  info(`${key}: "${cur.status}" → "${JIRA_TARGET_STATUS}" (${RELEASE_TAG})`);
}

async function main() {
  let body;
  try {
    body = await getReleaseBody();
  } catch (err) {
    return bailSoft(`${err.message} — skipping Jira sync`);
  }

  const keys = extractKeys(body);
  if (keys.length === 0) {
    info(`no ${JIRA_KEY_PREFIX}-* keys in ${RELEASE_TAG} release notes — nothing to sync`);
    return;
  }
  info(
    `${dryRun ? "[dry-run] " : ""}syncing ${keys.length} ticket(s) for ${RELEASE_TAG}: ${keys.join(", ")}`,
  );

  let failures = 0;
  for (const key of keys) {
    try {
      await syncOne(key);
    } catch (err) {
      failures++;
      warn(`${key}: ${err.message}`);
    }
  }
  // Soft-fail: report but never exit non-zero — prod already shipped.
  if (failures) warn(`${failures} ticket(s) could not be synced — see warnings above`);
  info("Jira sync complete");
}

main().catch((err) => bailSoft(`unexpected error: ${err.message}`));
