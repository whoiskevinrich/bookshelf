# Runbook: Transitioning Jira issues from CI (scoped API token, no automations)

How to move a Jira Cloud issue between statuses from a CI job (e.g. on deploy) with
no human step and no ongoing credential maintenance. Project-agnostic — the same
recipe works for any repo/project on the same Atlassian site (Bookshelf, Holodex, …).

> Reference implementation in this repo: `scripts/lib/jira-sync.mjs` +
> `scripts/jira-dev-sync.mjs` (dev `→ On Dev`) and `scripts/jira-release-sync.mjs`
> (prod `→ Done`), wired into `.github/workflows/deploy.yml` / `promote.yml`.

## Two traps this recipe is designed to avoid

Both were hit for real while building the Bookshelf sync (BOOKSHELF-84):

1. **Jira Automation is metered — don't use it for CI-frequency work.** On the
   **Free** plan you get **100 automation flow runs per month, shared across the
   whole site** (every project). A rule that fires on each deploy will silently
   exhaust the budget mid-month and then just stop. So we transition via the **REST
   API**, which is **not** counted against the automation quota.
2. **Scoped API tokens 401 against the site URL.** Atlassian's current "Create API
   token **with scopes**" flow issues tokens that **only** work through the gateway
   host `https://api.atlassian.com/ex/jira/{cloudId}/…` — **not**
   `https://<your-site>.atlassian.net/…`. Hitting the site URL with a scoped token
   returns `401 "Client must be authenticated to access this resource."` even though
   the token, email, and scopes are all correct. (Legacy **unscoped** tokens still
   work against the site URL; Atlassian now defaults to scoped.)

Result: a **scoped API token + the gateway base URL + Basic auth**. Stateless, no
OAuth refresh-token rotation, no automation runs.

## One-time setup

1. **Create a scoped API token.** [id.atlassian.com → Security → API tokens](https://id.atlassian.com/manage-profile/security/api-tokens)
   → **Create API token with scopes** → app **Jira** → scopes:
   - `read:jira-work` — read issue status + available transitions
   - `write:jira-work` — perform the transition
   - `read:jira-user` — the `/myself` verification probe (optional but handy)

   Copy the token (shown once). Note the **expiry** — scoped tokens expire (up to ~1
   year); set a calendar reminder to rotate. There is no per-run rotation to manage.

2. **Find your site's cloudId** (no auth needed):

   ```bash
   curl -s "https://<your-site>.atlassian.net/_edge/tenant_info"
   # → {"cloudId":"e7c03552-8036-43fa-bb8b-b415de46f9f6"}
   ```

3. **Build the gateway base URL:** `https://api.atlassian.com/ex/jira/<cloudId>`

4. **Verify the credential before wiring CI** — hit `/myself` through the gateway:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" \
     -u "<account-email>:<token>" -H "Accept: application/json" \
     "https://api.atlassian.com/ex/jira/<cloudId>/rest/api/3/myself"
   ```

   Expect **`200`**. If you get **`401`**, check you're using the **gateway** host
   (not `<site>.atlassian.net` — that 401 is the trap in trap #2) and that the email
   matches the token's account. On Windows use `curl.exe` (plain `curl` is a
   PowerShell alias for `Invoke-WebRequest`, which mangles the `Authorization` header).

5. **Store CI config** (GitHub example):

   ```bash
   gh variable set JIRA_BASE_URL   --repo <owner>/<repo> --body "https://api.atlassian.com/ex/jira/<cloudId>"
   gh secret   set JIRA_USER_EMAIL --repo <owner>/<repo> --body "<account-email>"
   gh secret   set JIRA_API_TOKEN  --repo <owner>/<repo>   # paste the scoped token
   ```

   `JIRA_BASE_URL` is a non-secret **variable**; the email and token are **secrets**.
   Repo-level scope makes them available to every workflow (including
   `environment:`-scoped jobs).

## The transition (Basic auth, against the gateway)

All three calls use `Authorization: Basic base64("<email>:<token>")` and the gateway
base URL. Transition names/ids are workflow-specific — always look up the id rather
than hard-coding it:

```
GET  {base}/rest/api/3/issue/{key}?fields=status        # current status
GET  {base}/rest/api/3/issue/{key}/transitions          # pick the one whose .to.name == target
POST {base}/rest/api/3/issue/{key}/transitions          # body: {"transition":{"id":"<id>"}}
```

Recommended behaviour (matches `scripts/lib/jira-sync.mjs`):

- **Idempotent** — skip if the issue is already at the target status.
- **Match on the transition's destination status name**, case-insensitive (robust to
  transition labels like "Done" vs "Mark as Done").
- **Soft-fail** — a missing secret, a Jira outage, or an unreachable transition logs
  a warning and exits 0, so a Jira hiccup never red-builds a deploy.

## Applying to another repo/project on the same site (e.g. Holodex)

- The **cloudId is per-site, not per-project**, and the scopes are site-wide — so the
  **same token + same gateway URL** works for every project on
  `<your-site>.atlassian.net`. You can reuse one token or mint a per-repo one.
- Set the same three config values in the new repo and call the gateway. Nothing
  else changes.

## Gotchas checklist

- ❌ Scoped token against `<site>.atlassian.net` → `401`. ✅ Always use
  `api.atlassian.com/ex/jira/{cloudId}`.
- ❌ Jira Automation rules for per-deploy transitions (burns the shared 100/month
  free quota). ✅ REST API (uncounted).
- Email in Basic auth **must** be the token owner's account email.
- Scoped tokens **expire** — calendar-reminder the rotation; there is no refresh flow.
- On Windows, use `curl.exe`, and set the email **before** building the auth header.

## Sources

- [Scoped API tokens must use `api.atlassian.com/ex/jira/{cloudId}`](https://support.atlassian.com/atlassian-cloud/kb/401-unauthorized-error-when-service-account-accesses-jira-or-confluence-api/)
- [Find your Cloud ID (`/_edge/tenant_info`)](https://support.atlassian.com/jira/kb/retrieve-my-atlassian-sites-cloud-id/)
- [Basic auth for Jira Cloud REST APIs](https://developer.atlassian.com/cloud/jira/platform/basic-auth-for-rest-apis/)
