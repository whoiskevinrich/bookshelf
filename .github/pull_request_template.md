<!--
QA checklist below. Items tagged [auto] are enforced by the QA Guards CI check
(scripts/qa-guards.mjs) and block merge if red — you don't need to tick them, but
leave them as a reference. Items tagged [attest] are yours to confirm before merging.
Canonical source: docs/runbooks/qa-checklist.md
-->

## Summary

<!-- What does this PR change, and why? -->

## How verified

<!-- Tests added/updated, local dev verification, `pnpm preflight` output, etc. -->

## Release note

<!--
User-facing change? Add a trailer line OUTSIDE this comment, on its own line, e.g.:

Release-Note: Find any book you own by title or author, right from your shelf.

Plain, present-tense, benefit-first — the app's voice, not the commit subject. It's
collected into the in-app "What's New" feed (docs/specs/whats-new.md). Leave this section
empty for internal/CI/infra/test/chore changes — no trailer, no feed entry.
-->

## QA checklist

**General**

- [ ] [attest] Error boundaries / handling on all async operations
- [ ] [attest] External-service credentials via env vars, never literals
- [ ] [auto] No `console.log`/`info`/`debug` in production code

**Bookshelf domain** (if touched)

- [ ] [auto] ISBN via `lib/isbn.ts` (`isValidIsbn`/`normalizeIsbn`) — no local digit regex
- [ ] [attest] ASIN validated `/^[A-Za-z0-9]{1,20}$/`
- [ ] [attest] Book API calls have error boundary + fallback UI
- [ ] [attest] Wishlist vs. Owned kept distinct
- [ ] [attest] Zero-books / empty-shelf state handled
- [ ] [attest] Duplicate ISBN/ASIN checked before add
- [ ] [attest] Cover images have broken-image fallback

**UI / design system** (if touched)

- [ ] [auto] No raw `bg-indigo-600`/`bg-gray-900` buttons — use `<Button>`
- [ ] [auto] No `text-gray-400` for muted text (WCAG AA)
- [ ] [attest] No hover-only affordances (pair `group-hover:` with `focus-within:`)
- [ ] [attest] Auth inputs/labels use `inputClass`/`labelClass`
- [ ] [attest] Spinners have `role="status"` + `aria-label`
- [ ] [attest] Color-coded state also uses shape/icon

**Security**

- [ ] [auto] No auth bypass (`VITE_MOCK_API`/`MOCK_MODE`/`dev:mock`/`mocks/browser`)
- [ ] [auto] No committed env files (only `*.example` tracked)
- [ ] [attest] No hardcoded secrets
- [ ] [attest] User-supplied ISBN/ASIN sanitized before external calls

**New endpoint** (if adding a route)

- [ ] [auto] `router.use("*", authMiddleware)` applied at router level
- [ ] [auto] Global `bodyLimit` still registered in `app.ts`
- [ ] [attest] Path params validated; free-text query has max-length cap
- [ ] [attest] DynamoDB text fields capped; `BookMetadata` via `sanitizeBookMetadata`
- [ ] [attest] Pagination cursors → 400 on failure; 500s never leak internals
- [ ] [attest] Status codes precise (400/404/409/502)
