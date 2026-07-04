# Runbook: Verifying Required GitHub Secrets & Variables

GitHub Actions **silently expands an unset `${{ secrets.X }}` or `${{ vars.Y }}`
to an empty string** — no warning, no failure at expansion time. The breakage
surfaces later, deep inside a job, looking like an application bug rather than a
missing credential. Two real examples from the E2E pipeline (BOOKSHELF-4):

- **Missing entirely** → empty. `GOOGLE_BOOKS_API_KEY` was referenced in
  `e2e.yml` but never set, so the API server called Google Books anonymously and
  got throttled (`429 Too Many Requests`) from the shared runner IP. Every
  book-search spec failed with a UI symptom ("Add Owned" button never appears").
- **Present but wrong** → can't be read back. `TEST_USER_PASSWORD` existed but
  didn't match the QA Cognito user, so `auth.setup.ts` login timed out. `gh secret
  list` shows the name, never the value, so a stale/mistyped secret is invisible
  until you exercise it.

This runbook is the fast path to rule both out before spelunking application code.

> **Provisioning** (creating the roles, secrets, and vars in the first place) lives
> in [`cicd-setup.md`](./cicd-setup.md). This runbook is about **verifying** they
> exist, are in the right **scope**, and hold **working values**.

---

## 1. What each workflow requires

Kept in sync by hand — regenerate the reference columns with the grep in §2.

| Name                 | Kind   | Scope        | Used by                     | How to verify the **value** works |
| -------------------- | ------ | ------------ | --------------------------- | --------------------------------- |
| `AWS_ROLE_ARN`       | var    | env (dev/prod) | deploy, e2e, promote      | The "Configure AWS credentials" step succeeds (OIDC assume) |
| `AWS_REGION`         | var    | env (dev/prod) | deploy, e2e, promote      | Non-empty; `us-west-2` for dev |
| `TEST_USER_EMAIL`    | secret | repo         | e2e                         | Matches a real Cognito user (§4) |
| `TEST_USER_PASSWORD` | secret | repo         | e2e                         | Authenticates that user (§4) |
| `JIRA_BASE_URL`      | var    | env (prod)   | promote (release sync)      | Non-empty site URL |
| `JIRA_USER_EMAIL`    | secret | repo         | promote (release sync)      | A Jira API call succeeds |
| `JIRA_API_TOKEN`     | secret | repo         | promote (release sync)      | A Jira API call succeeds |

**Scope matters and is easy to get wrong:**

- **Repo secrets** are available to every workflow, including jobs with an
  `environment:`. So `TEST_USER_*` at the repo level works for the `dev`-environment
  E2E job.
- **Environment secrets/vars** are available **only** to jobs that declare the
  matching `environment:`. Here `AWS_ROLE_ARN` / `AWS_REGION` are **environment**
  vars (dev vs prod resolve to different roles) — a plain `gh variable list` shows
  **nothing** and would wrongly look "missing". You must pass `--env`.
- Prefer **SSM over a duplicated secret** when an OIDC role can read the value at
  runtime — one source of truth, nothing to rotate in two places. That's why
  `e2e.yml` sets `GOOGLE_BOOKS_API_KEY_SSM_NAME=/bookshelf/google-books-api-key`
  (read by the deployed Lambda too) instead of a `GOOGLE_BOOKS_API_KEY` secret.

---

## 2. Enumerate what the workflows actually reference

```bash
# Every secret/var referenced, deduped
grep -rhoE "secrets\.[A-Z_]+|vars\.[A-Z_]+" .github/workflows/ | sort -u

# Broken down per workflow (spot which job needs what)
for f in .github/workflows/*.yml; do
  echo "--- $f ---"
  grep -hoE "secrets\.[A-Z_]+|vars\.[A-Z_]+" "$f" | sort -u
done
```

---

## 3. List what actually exists (mind the scope)

```bash
REPO="whoiskevinrich/bookshelf"

# Repo-level (names + last-updated only — never values)
gh secret   list --repo "$REPO"
gh variable list --repo "$REPO"

# Environment-scoped — REQUIRED for AWS_ROLE_ARN / AWS_REGION / prod JIRA_BASE_URL
gh secret   list --repo "$REPO" --env dev
gh variable list --repo "$REPO" --env dev
gh secret   list --repo "$REPO" --env prod
gh variable list --repo "$REPO" --env prod
```

Cross-check the §2 output against §3. A name in §2 that is absent from **every**
relevant scope in §3 is the missing-entirely failure mode — set it before re-running.

A recent `Updated` timestamp on a secret does **not** mean the value is correct — it
only means someone wrote *something*. Confirm the value with §4.

---

## 4. Verify the **value**, not just presence

You cannot read a secret back, so exercise it against the real service.

**Cognito test user (`TEST_USER_EMAIL` / `TEST_USER_PASSWORD`).** The exact check
that would have caught the BOOKSHELF-4 auth failure in seconds:

```bash
POOL=us-west-2_NxOrdblYM        # green dev pool
CID=55pbv5thiot3onr7t144kmn8de  # UserPoolClientId (BookshelfAuth output)
USER="whoiskevinrich+bookshelf-qa@gmail.com"

# 1. Account is usable (not FORCE_CHANGE_PASSWORD / disabled)
aws --profile dev/AWSPowerUserAccess --region us-west-2 cognito-idp admin-get-user \
  --user-pool-id "$POOL" --username "$USER" \
  --query "{status:UserStatus,enabled:Enabled}" --output json

# 2. The password value actually authenticates (client allows USER_PASSWORD_AUTH)
aws --profile dev/AWSPowerUserAccess --region us-west-2 cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH --client-id "$CID" \
  --auth-parameters USERNAME="$USER",PASSWORD='<candidate>' \
  --query "{token:AuthenticationResult.TokenType,challenge:ChallengeName}" --output json
# Expect: {"token":"Bearer","challenge":null}. A challenge (e.g. new-password) means
# the app's isSignedIn stays false and login never redirects.
```

If the password is wrong, rotate to a value you set in **both** places at once:

```bash
aws --profile dev/AWSPowerUserAccess --region us-west-2 cognito-idp admin-set-user-password \
  --user-pool-id "$POOL" --username "$USER" --password '<new>' --permanent
printf '%s' '<new>' | gh secret set TEST_USER_PASSWORD --repo whoiskevinrich/bookshelf
# Also update apps/web/.env.test.local so local `pnpm -F @bookshelf/web test:e2e` matches.
```

**SSM-sourced values (e.g. `/bookshelf/google-books-api-key`).** Confirm the
parameter exists and the job's OIDC role can read it (the dev role has broad
access; a scoped role needs `ssm:GetParameter` + `kms:Decrypt`):

```bash
aws --profile dev/AWSPowerUserAccess --region us-west-2 \
  ssm get-parameter --name "/bookshelf/google-books-api-key" --with-decryption \
  --query "Parameter.Type" --output text   # SecureString
```

**AWS OIDC var (`AWS_ROLE_ARN`).** Correct if the "Configure AWS credentials" step
in a real run succeeds. The role name encodes the account/env
(`bookshelf-github-actions-dev` vs `-prod`) — a dev/prod mix-up deploys to the
wrong account.

---

## 5. Where diagnostics land when a value is wrong

- The Playwright HTML report is uploaded by the E2E job (`playwright-report/`).
  If the "Upload Playwright report" step says *"No files were found"*, the report
  wasn't generated — check the `reporter` includes `html` in CI
  (`apps/web/playwright.config.ts`).
- The E2E job pipes the API/web dev-server stdout, so upstream failures show as
  `[WebServer] ...` lines in the "Run E2E" log (that's where the Google Books
  `429` surfaced). `grep` the run log for `[WebServer]` and the HTTP status.

---

## Quick preflight (copy-paste)

```bash
REPO="whoiskevinrich/bookshelf"
echo "== required by workflows =="
grep -rhoE "secrets\.[A-Z_]+|vars\.[A-Z_]+" .github/workflows/ | sort -u
echo "== present (repo) =="; gh secret list --repo "$REPO"; gh variable list --repo "$REPO"
echo "== present (dev) ==";  gh secret list --repo "$REPO" --env dev;  gh variable list --repo "$REPO" --env dev
echo "== present (prod) =="; gh secret list --repo "$REPO" --env prod; gh variable list --repo "$REPO" --env prod
# Then value-check anything credential-like against its live service (§4).
```
