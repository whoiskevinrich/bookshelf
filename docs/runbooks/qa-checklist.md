# Runbook: PR QA Checklist

The canonical QA checklist for every pull request. The PR template
(`.github/pull_request_template.md`) mirrors this list as checkboxes, and the
`code-reviewer` subagents read it via `CLAUDE.md`.

Each item is tagged:

- **[auto]** — mechanically enforced by `pnpm qa:guards` (`scripts/qa-guards.mjs`)
  or another CI check. It runs on every PR (`.github/workflows/pr.yml` → **QA Guards**)
  and **blocks merge** when red. You do not need to self-verify these — but if one
  trips, the failure message names the exact `file:line`.
- **[attest]** — judgment items CI cannot reliably check. You confirm these yourself
  before merging; they live as checkboxes in the PR template.

Run the auto checks locally any time with `pnpm qa:guards` (also part of `pnpm preflight`).

---

## General

- **[auto]** No `console.log` / `console.info` / `console.debug` in production code
  (`console.error` / `console.warn` are allowed; dev-server `server.ts` entrypoints are exempt).
- **[attest]** Error boundaries / error handling on all async operations.
- **[attest]** External-service credentials come from environment variables, never literals.

## Bookshelf domain

- **[auto]** ISBN validation uses `isValidIsbn` / `normalizeIsbn` from `apps/api/src/lib/isbn.ts`
  — no local digit-only ISBN regex in route/handler files.
- **[attest]** ASIN input validated against `/^[A-Za-z0-9]{1,20}$/`.
- **[attest]** Book API calls have an error boundary + fallback UI.
- **[attest]** Wishlist vs. Owned states stay distinct — never conflated in one structure.
- **[attest]** Zero-books / empty-shelf state handled in all list views.
- **[attest]** Duplicate detection: ISBN/ASIN checked before adding a book.
- **[attest]** Cover images have a broken-image fallback on every external CDN URL.

## UI / design system

- **[auto]** No raw `bg-indigo-600` / `bg-gray-900` button classes in `apps/web/src`
  — use `<Button>` from `src/components/ui/Button.tsx`.
- **[auto]** No `text-gray-400` for muted text (fails WCAG AA) — minimum
  `text-gray-500 dark:text-zinc-400`.
- **[attest]** No hover-only affordances — pair any `group-hover:` reveal with a
  `focus-within:` / `focus:` fallback so touch and keyboard users get it too.
- **[attest]** Auth form inputs/labels import `inputClass` / `labelClass` from `src/lib/form-styles.ts`.
- **[attest]** Loading spinners (`animate-spin`) include `role="status"` and an `aria-label`.
- **[attest]** State shown by color also carries a shape/icon distinction (color-blind users).

## Security

- **[auto]** No auth bypass anywhere in app source (NON-NEGOTIABLE): no `VITE_MOCK_API`,
  `MOCK_MODE`, `dev:mock`, or MSW `mocks/browser` wiring. Auth always runs against the real
  dev Cognito pool.
- **[auto]** No committed env files (NON-NEGOTIABLE): only `*.example` may be tracked;
  real values live in gitignored `.env.local`.
- **[attest]** No hardcoded API keys or secrets in source.
- **[attest]** ISBN/ASIN from user input sanitized before external API calls.

## New-endpoint checklist (any new route)

- **[auto]** Auth applied at the router level — every `apps/api/src/routes/*.ts`
  calls `router.use("*", authMiddleware)` (except `_utils.ts`).
- **[auto]** Global `bodyLimit` middleware remains registered in `apps/api/src/app.ts`.
- **[attest]** Every path parameter validated (format + allowlist) before use as a
  DynamoDB key or external-API input; 400 on failure.
- **[attest]** Free-text query strings have a max-length cap (e.g. `q` ≤ 200 chars).
- **[attest]** Every text field written to DynamoDB has a named max-length constant near
  the write site; `BookMetadata` sanitized via `sanitizeBookMetadata` before `putBookMetadata`.
- **[attest]** Pagination cursors validated → 400 (catch `InvalidCursorError`), not 500.
- **[attest]** 500 responses never leak raw exception messages/stack traces — generic
  string out, real error logged server-side with `console.error`.
- **[attest]** Status codes precise: malformed → 400, not found → 404, duplicate → 409,
  bad upstream → 502.

---

## Making the gate enforceable (one-time)

The **QA Guards** job only protects `main` if branch protection requires it:

1. GitHub → **Settings → Branches → Branch protection rules → `main`**.
2. Under **Require status checks to pass before merging**, add **QA Guards** (and confirm
   **Lint**, **Unit Tests**, **Type Check**, **CDK Synth** are present). There is no
   **Unique Version** check — the version is CI-derived at deploy (ADR-017).
3. Save. A failing guard now blocks merge.
