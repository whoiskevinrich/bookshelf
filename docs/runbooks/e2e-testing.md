# Runbook: End-to-End Testing (Playwright)

The E2E suite drives the real app (React SPA + Hono API) against the **real dev
Cognito + DynamoDB** — no mock auth (per CLAUDE.md). It locks in the large surface
shipped in #81 (shelf management) and #82 / ADR-019 (attributes, tags, reading
status, book-detail view, auto/smart shelves).

Specs live in `apps/web/e2e/`:

| File                       | Covers                                                                  |
| -------------------------- | ----------------------------------------------------------------------- |
| `auth.setup.ts`            | Signs in once via the real login page; saves the session to `.auth/`    |
| `books-auth.spec.ts`       | Auth gate (401s) + a signed-in search                                   |
| `shelf-happy-path.spec.ts` | search → add Owned → remove; add Want → move to Owned                   |
| `book-detail.spec.ts`      | `/book/:isbn` "Your copy": owned/want, reading status, tags, notes; 404 |
| `smart-shelf.spec.ts`      | facet filter → save smart shelf → apply → delete                        |
| `helpers.ts`               | Shared add/remove/cleanup helpers (see "Shared-account design" below)   |

## Running locally

1. **Credentials.** Copy `apps/web/.env.test.local.example` → `apps/web/.env.test.local`
   (gitignored) and fill in the dedicated dev-only QA user (green pool
   `us-west-2_NxOrdblYM`). The email is prefilled; the password lives in your password
   manager / the CI `TEST_USER_PASSWORD` secret — **never** commit it and **never**
   `VITE_`-prefix it (Vite inlines `VITE_*` into the browser bundle).

2. **Browser.** One-time: `pnpm --filter @bookshelf/web exec playwright install chromium`.

3. **Run.** The API dev server needs live dev credentials, and Granted's `assume` env
   vars don't survive across shells — so assume and run in one shell:

   ```powershell
   . $PROFILE
   assume dev/AWSPowerUserAccess
   pnpm --filter @bookshelf/web run test:e2e      # add :ui to debug
   ```

   `playwright.config.ts` starts the API (`:3001`) and web (`:3000`) dev servers itself
   (`webServer`), reusing any you already have running from `/dev`. Both read their
   `.env.local` for Cognito/table config.

## CI

E2E runs in `.github/workflows/e2e.yml` — **post-merge (push to `main`) and nightly
(09:00 UTC), plus manual `workflow_dispatch`. It is deliberately NOT part of PR
Checks.** Real Cognito/DynamoDB is slower and can flake on AWS/network, so gating every
PR on it would trade the fast, deterministic unit checks for noise; instead it validates
the merged code end-to-end against the live dev backend. The job assumes the dev OIDC
role, resolves Cognito/table config from CloudFormation outputs into `.env.local`, then
runs the same `test:e2e`. The Playwright report is uploaded as an artifact.

Required config (already provisioned): dev environment `AWS_ROLE_ARN` / `AWS_REGION`
vars, and `TEST_USER_EMAIL` / `TEST_USER_PASSWORD` (and optional `GOOGLE_BOOKS_API_KEY`)
secrets.

## Shared-account design (why the helpers look the way they do)

All signed-in specs mutate **one** shared QA account's shelf, so the suite is built to
be serial and self-cleaning:

- **Serial only** (`workers: 1`, `fullyParallel: false`). Parallel workers race on the
  same data — a book one test adds appears in another; a cleanup empties the shelf
  mid-add. The suite is small, so the wall-clock cost is a few dozen seconds.
- **Distinct ISBNs per spec** and **presence-based assertions** (never exact counts), so
  a stray book left by a crashed run can't fail a passing test.
- **`addBookByIsbn` removes-first**, then asserts the intended Owned/Want pill — a
  crashed run can leave a book with the wrong status, which would otherwise 409 and go
  unnoticed.
- **Presence checks wait for the shelf to settle** (the `role="status"` "Loading books"
  skeleton to clear) before reading the DOM — a still-loading grid reads as "empty" and
  silently skips cleanup, letting residue pile up.
- **Smart-shelf chips render only in the unfiltered view**; applying a filter hides the
  group. Saving, then revealing/deleting a smart shelf both require clearing the filter.
  Deleting also goes through a confirm dialog.

If the QA account ever accumulates junk (e.g. after a hard crash), just run the suite —
each test's `beforeEach`/`afterEach` sweeps its own books and any `e2e-`prefixed smart
shelves.
