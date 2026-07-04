// Shared, dependency-free helpers for CI-side Jira status sync (ADR-022 / ADR-024).
//
// Two entry points build on this:
//   - jira-release-sync.mjs → transitions release tickets to "Done" on prod promote
//   - jira-dev-sync.mjs      → transitions merged tickets to "On dev" on dev deploy
//
// Both are idempotent (skip a ticket already at the target) and SOFT-FAIL by design:
// a Jira outage, a missing key, or an unreachable transition logs a GitHub
// `::warning::` and the run continues — a Jira hiccup must never red-build a deploy
// that already succeeded and smoke-passed. Node 22 global `fetch`/`Buffer`; no deps.

export function makeLog(label = "jira-sync") {
  return {
    warn: (msg) => console.log(`::warning::[${label}] ${msg}`),
    info: (msg) => console.log(`[${label}] ${msg}`),
  };
}

// All unique, upper-cased issue keys in `text` for the given project prefix.
export function extractKeys(text, prefix = "BOOKSHELF") {
  const re = new RegExp(`\\b${prefix}-\\d+\\b`, "gi");
  const keys = new Set();
  for (const m of (text ?? "").matchAll(re)) keys.add(m[0].toUpperCase());
  return [...keys];
}

// Pure: pick the transition whose DESTINATION status matches (case-insensitive) —
// robust to transition naming like "Done" vs "Mark as Done".
export function selectTransitionId(transitions, targetStatus) {
  const target = targetStatus.toLowerCase();
  const t = (transitions ?? []).find((tr) => tr.to?.name?.toLowerCase() === target);
  return t?.id ?? null;
}

export function makeJiraClient({ baseUrl, email, token }) {
  const base = baseUrl.replace(/\/+$/, "");
  const headers = {
    Authorization: "Basic " + Buffer.from(`${email}:${token}`).toString("base64"),
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  return {
    async currentStatus(key) {
      const res = await fetch(`${base}/rest/api/3/issue/${key}?fields=status`, { headers });
      if (res.status === 404) return { missing: true };
      if (!res.ok) throw new Error(`GET issue ${key} failed: ${res.status} ${res.statusText}`);
      const json = await res.json();
      return { status: json.fields?.status?.name ?? null };
    },
    async findTransitionId(key, targetStatus) {
      const res = await fetch(`${base}/rest/api/3/issue/${key}/transitions`, { headers });
      if (!res.ok)
        throw new Error(`GET transitions for ${key} failed: ${res.status} ${res.statusText}`);
      const json = await res.json();
      return selectTransitionId(json.transitions, targetStatus);
    },
    async transition(key, transitionId) {
      const res = await fetch(`${base}/rest/api/3/issue/${key}/transitions`, {
        method: "POST",
        headers,
        body: JSON.stringify({ transition: { id: transitionId } }),
      });
      if (!res.ok)
        throw new Error(
          `POST transition ${transitionId} on ${key} failed: ${res.status} ${res.statusText}`,
        );
    },
  };
}

async function syncOne({ key, targetStatus, client, dryRun, log, context }) {
  const cur = await client.currentStatus(key);
  if (cur.missing) return log.warn(`${key}: not found in Jira — skipping`);
  if (cur.status?.toLowerCase() === targetStatus.toLowerCase()) {
    return log.info(`${key}: already "${targetStatus}" — no-op`);
  }
  const id = await client.findTransitionId(key, targetStatus);
  if (!id) {
    return log.warn(
      `${key}: no transition to "${targetStatus}" available from "${cur.status}" — skipping`,
    );
  }
  if (dryRun) {
    return log.info(
      `${key}: [dry-run] would transition "${cur.status}" → "${targetStatus}" (id ${id})`,
    );
  }
  await client.transition(key, id);
  log.info(`${key}: "${cur.status}" → "${targetStatus}"${context ? ` (${context})` : ""}`);
}

// Transition every key toward targetStatus. Per-key try/catch — never throws;
// returns the failure count so the caller can log a summary.
export async function syncKeys({ keys, targetStatus, client, dryRun, log, context }) {
  let failures = 0;
  for (const key of keys) {
    try {
      await syncOne({ key, targetStatus, client, dryRun, log, context });
    } catch (err) {
      failures++;
      log.warn(`${key}: ${err.message}`);
    }
  }
  if (failures) log.warn(`${failures} ticket(s) could not be synced — see warnings above`);
  return failures;
}
