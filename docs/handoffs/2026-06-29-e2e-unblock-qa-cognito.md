# Handoff: Unblock E2E — dev QA Cognito account + CI secrets

**Status:** ✅ Done (2026-06-29) · **Type:** ops / setup · **Unblocks:** E2E `[P1]`
(Active › Test coverage). · **Source:** `todo/TASKS.md › Backlog › Testing`.

## Mission

Create the dev-only QA test user and wire its credentials so Playwright E2E can authenticate
locally and in CI. This is the **sole blocker** on the E2E `[P1]` item.

## Context

- E2E auth uses **real Cognito** via `apps/web/e2e/auth.setup.ts` (real-SRP login).
  **[NON-NEGOTIABLE] no mock auth.**
- Dev env: account `058308164167`, region `us-west-2`, **green** user pool
  `us-west-2_NxOrdblYM`. No QA user exists yet.

## Steps

1. **Create a dedicated dev-only user** in the green pool, confirmed, with a permanent
   password (use an address you control, e.g. a `+qa` alias):
   ```powershell
   aws --profile dev/AWSPowerUserAccess cognito-idp admin-create-user `
     --user-pool-id us-west-2_NxOrdblYM --username "<qa-email>" --message-action SUPPRESS
   aws --profile dev/AWSPowerUserAccess cognito-idp admin-set-user-password `
     --user-pool-id us-west-2_NxOrdblYM --username "<qa-email>" --password "<pw>" --permanent
   ```
2. **Local:** copy `apps/web/.env.test.local.example` → `apps/web/.env.test.local` and fill
   in the email + password. The password must **not** be `VITE_`-prefixed and **never**
   committed (`.env.test.local` is gitignored).
3. **CI:** add repo secrets `TEST_USER_EMAIL` / `TEST_USER_PASSWORD`
   (`gh secret set TEST_USER_EMAIL`, etc.).
4. **CI wiring** (note for the E2E session): the E2E job needs the API to reach dev DynamoDB
   (reuse the existing `AWS_ROLE_ARN_DEV` OIDC role) and `npx playwright install --with-deps`.

## Guardrails

- **[NON-NEGOTIABLE] No mock auth** — real Cognito only.
- **Never commit secrets** (CLAUDE.md security rule). Password lives only in
  `.env.test.local` (local) and repo secrets (CI).
- **Dev only** — do not create this user in prod (`071526660165`).

## Definition of done

- A confirmed QA user exists in `us-west-2_NxOrdblYM`.
- `apps/web/.env.test.local` present locally; `pnpm -F @bookshelf/web test:e2e` authenticates
  via `auth.setup.ts`.
- `TEST_USER_EMAIL` / `TEST_USER_PASSWORD` repo secrets set.
- Hand back to the E2E session (Active › Test coverage) to write specs + wire the CI job.

---

## Progress log (this session — goofy-easley-52160b, 2026-06-29)

- Migrated this handoff from the `sharp-tereshkova-1947cd` worktree into the working branch.
- **Discovered a blocker the original steps missed:** the dev pool is invitation-only — the
  `PreSignUp` Lambda (`packages/infra/lambda/pre-signup/index.js`) enforces an `EMAIL_ALLOWLIST`,
  and `admin-create-user` fires `PreSignUp_AdminCreateUser`, so it was rejected with
  "Access restricted." The allowlist only gates **account creation** (and first federated
  sign-in), not subsequent SRP/password sign-in.
- **Allowlist (IaC + deploy, durable):** added `whoiskevinrich+bookshelf-qa@gmail.com` to
  `googleEmailAllowlist` in `packages/infra/bin/bookshelf.ts` (dev config). `cdk diff` confirmed
  the only functional change was `PreSignUpFn`'s `EMAIL_ALLOWLIST` env var (callback URLs
  unchanged — deployed with `-c env=dev -c version=v0.1.56 -c cloudfront-domain=…`). Deployed
  `BookshelfAuth` to dev (16s; pool id unchanged).
- **User:** `admin-create-user` (SUPPRESS, `email_verified=true`) → `admin-set-user-password
--permanent`. Status now `CONFIRMED`. Username is a UUID (email-alias pool) — login is by email.
- **Verified:** `cognito-idp initiate-auth --auth-flow USER_PASSWORD_AUTH` returned a Bearer
  token, 3600s, **no challenge** — credential is sign-in-ready, exactly what `auth.setup.ts` needs.
- **Local:** wrote `apps/web/.env.test.local` (gitignored) with `TEST_USER_EMAIL` / `TEST_USER_PASSWORD`.
- **CI:** set `TEST_USER_EMAIL` / `TEST_USER_PASSWORD` repo secrets (`gh secret set`).
- **Task list:** marked the _Backlog › Testing_ item done; flipped the blocker flag on the
  _Active › Test coverage_ E2E item and the _Now_ cycle-goal line.

### Still owned by the E2E session (Active › Test coverage)

1. Write the happy-path + detail-view + smart-shelf E2E specs on the #73 scaffold.
2. Wire the E2E job into CI: reuse `AWS_ROLE_ARN_DEV` (OIDC) so the API reaches dev DynamoDB,
   `npx playwright install --with-deps`, and inject the two repo secrets.

### Note

The IaC allowlist change (`bin/bookshelf.ts`) is committed on branch `claude/goofy-easley-52160b`
and is live in dev. It still needs to land on `main` so future `cdk diff`/deploys are a no-op and
the QA user is reproducible if the green pool is ever rebuilt.
