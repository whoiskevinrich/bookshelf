# ADR-022: Jira Release Sync — Transition Tickets to Done on Prod Promote

**Status**: Accepted
**Date**: 2026-07-02
**Relates to**: [ADR-020](020-release-please-promotion-gate.md) (Release Please as the prod gate). Tasks live in the Jira **BOOKSHELF** project (moved off `todo/TASKS.md` on 2026-06-30).

## Context

Since the task backend moved to Jira, ticket status is maintained by hand. Commits already carry the Jira key in the subject (e.g. `feat(web): … (BOOKSHELF-69) (#92)`), and Release Please batches those commits into a `vX.Y.Z` release with a CHANGELOG. But nothing closes the loop: a ticket's code can be live in prod while its Jira status still says "In Progress." We want the ledger to reflect reality without a manual step per ticket.

The interactive **Atlassian MCP connector** (used in dev sessions) is OAuth-based and cannot run in GitHub Actions, so a CI-side sync must use the **Jira REST API with a static API token** — a separate credential path from the MCP connector and its in-session write-guard rules.

## Decision

**After a prod promote succeeds, transition every Jira ticket referenced in the release to `Done`.** A new `scripts/jira-release-sync.mjs` runs as the final step of `promote.yml`.

### Where and when

Hooked at the **end of `promote.yml`, after prod smoke passes** — not at release-PR merge or tag creation. A ticket moves to `Done` only when its code is **verifiably live in prod**, matching the ADR-020 gate. A cut tag that fails to promote never falsely closes tickets.

### How

- **Source of truth for "what shipped"** is the GitHub Release notes for this tag (release-please's CHANGELOG body), read via the GitHub REST API. Commit subjects there carry the `BOOKSHELF-\d+` keys — no git-history depth needed.
- For each unique key: `GET` its current status (skip if already `Done` — **idempotent**, so re-promotes and hotfixes are no-ops), look up the transition whose destination status is `Done`, and `POST` it.
- **Target status and key prefix are env-configurable** (`JIRA_TARGET_STATUS` default `Done`, `JIRA_KEY_PREFIX` default `BOOKSHELF`).
- **Soft-fail by design**: a missing secret, a Jira outage, an unknown key, or a missing transition logs a GitHub `::warning::` and exits 0. Prod already shipped and smoke-passed — a Jira hiccup must never turn a good deploy red (same principle as ADR-017's idempotent release).

### Credentials

`vars.JIRA_BASE_URL` (non-secret site URL) + `secrets.JIRA_USER_EMAIL` + `secrets.JIRA_API_TOKEN` (Atlassian API token), consumed only by the promote job. No new AWS/OIDC permissions — the step talks only to the GitHub and Jira REST APIs.

## Alternatives considered

- **Sync at release-PR merge / `release_created`** (in `release-please.yml`). Fires before prod is verified, so a ticket could read `Done` while the promote is still running or has failed. Rejected: status should mean "live in prod."
- **Set a Jira Fix Version** (`vX.Y.Z`) instead of / in addition to a transition. Useful as a release view, but the ask was a status transition; Fix Version is a clean additive follow-up (create the version, stamp `fixVersions`) if wanted later.
- **Comment-only** (link the release, leave status alone). Non-destructive but doesn't close the loop — the manual status step remains.
- **Atlassian MCP connector from CI.** Can't — OAuth/interactive only. Hence the REST-API-with-token path.

## Implementation

- **`scripts/jira-release-sync.mjs`** (new) — dependency-free (Node 22 global `fetch`); reads the release body, extracts keys, transitions each; soft-fails.
- **`promote.yml`** — new "Sync Jira tickets → Done" step after "Smoke tests (prod)", gated `if: success()`, passing the Jira secrets/vars and `RELEASE_TAG`. Existing `contents: read` permission covers reading the release.
- **Repo config** — add `vars.JIRA_BASE_URL`, `secrets.JIRA_USER_EMAIL`, `secrets.JIRA_API_TOKEN`.
- **Docs** — this ADR + a `docs/decisions.md` row; note the secrets in `docs/runbooks/cicd-setup.md`.

## Consequences

**Good**

- Jira status tracks prod reality automatically; no per-ticket manual step.
- Truthful timing — a ticket is `Done` only when its code is live and smoke-passed in prod.
- Idempotent and soft-failing — safe to re-run; never red-builds a successful deploy.

**Trade-offs**

- Depends on **Conventional-Commit subjects carrying the Jira key**. A commit that omits its key won't sync (visible: the ticket simply stays where it was; no false positive).
- Introduces a **static Jira API token** as a CI secret, separate from the MCP connector — one more credential to rotate.
- Only handles the forward transition (→ `Done`); it never reopens or moves tickets backward on a rollback.
