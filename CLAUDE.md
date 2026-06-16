# Bookshelf — Session Contract

## About

Solo developer. Web app for users to track books they own and want to read.
Tech stack: Hono on Lambda + DynamoDB + Cognito + React SPA — see `docs/adrs/001-tech-stack.md`.
Deployment target: AWS (CDK) — dev environment live; see `docs/runbooks/cicd-setup.md`.

## Mandatory Session Start

Always begin every session with `/productivity:start`.
No implementation work begins before running this skill.

## Task List (Single Source of Truth)

The **only** task list is `todo/TASKS.md` in the **main worktree** (`G:\source\bookshelf\todo\TASKS.md`) — gitignored, so branch switches never touch it, and shared by every session. **There is no `docs/TASKS.md`.**

All `/productivity:*` skills (`start`, `task-management`, `update`) must read and write **this** file. When a session runs inside a `.claude/worktrees/` worktree, still target the **main worktree's** `todo/TASKS.md` — never create a per-worktree copy — so tasks never fork across worktrees.

## Worktree Setup (new worktrees only)

When opening a session inside a git worktree (path contains `.claude/worktrees/`), run the setup script before any dev work.

**From bash (Bash tool):**

```bash
bash scripts/worktree-setup.sh
```

**From PowerShell (PowerShell tool):**

```powershell
.\scripts\worktree-setup.ps1
```

Both forms do the same thing: copy `apps/api/.env.local` and `apps/web/.env.local` from the main worktree (`G:\source\bookshelf`). Without these files neither the API nor the frontend can connect to Cognito or DynamoDB.

If the script reports nothing to copy (files already exist), proceed normally.
If the main worktree path differs, pass it:

- Bash: `bash scripts/worktree-setup.sh -MainWorktree "C:\path\to\bookshelf"`
- PowerShell: `.\scripts\worktree-setup.ps1 -MainWorktree "C:\path\to\bookshelf"`

**After setup, start the dev servers** — see `docs/runbooks/local-dev.md`:

```
/dev
```

This skill checks for active AWS credentials, acquires them via
`assume dev/AWSPowerUserAccess` if needed, then starts the API and web servers.

**[NON-NEGOTIABLE] Never use `dev:mock` mode.** Auth always runs against the real dev Cognito pool. Mock mode bypasses authentication entirely and must not be used or suggested — it produces a dev environment that doesn't reflect real app behaviour.

## AWS Environments & Local CDK

- **One AWS account per environment.** Use that env's `AWSPowerUserAccess` SSO profile; list names with `aws configure list-profiles` if unsure. Pass `aws --profile …` explicitly — Granted `assume` env vars don't persist across Claude tool calls (fresh shell each call).
  - **dev** = `dev/AWSPowerUserAccess` (account `058308164167`) → `https://d1n55zwqulukok.cloudfront.net`
  - **prod** = `prod/AWSPowerUserAccess` (account `071526660165`) → `https://bookshelf.whoiskevinrich.com` — **this domain is PROD, not dev**
- `cdk synth|diff|deploy` fail `CannotFindAsset` unless `apps/{api,mcp,web}/dist` exist — `pnpm -r build` first.
- Clean no-op `cdk diff`: `-c env=dev -c version=<active> -c cloudfront-domain=d1n55zwqulukok.cloudfront.net` (omitting the last two diffs SPA callback URLs / version tags spuriously).
- Cognito pool changes are **blue/green** via `-c authPool=legacy|cutover|green` (ADR-015) — never change email mutability or pool-identity props in place. The `green` deploy must run Api/Mcp/Web **before** BookshelfAuth (CFN won't delete still-imported exports).
- **Release version is CI-derived (ADR-017):** the deploy workflow computes `max(existing v* tags) + 1` at merge time and tags after smoke passes. Never bump `package.json` (pinned to `0.0.0`) or create version tags by hand — there's no pre-PR bump step anymore.

## Workflow: Idea to Production

> **Installed-skill caveat:** `/engineering:*` is now installed and available. Only `/vercel:*` remains **not installed** and will fail if invoked. This project deploys via **AWS CDK + GitHub Actions**, not Vercel — use the CDK/manual equivalent wherever a phase below references a Vercel skill.

### Phase 0 — Session Start

- `/productivity:start` — always first

### Phase 1 — Specification (before any code)

1. `/product-management:brainstorm` — if idea is vague
2. `/product-management:write-spec` — required; output to `docs/specs/<slug>.md`
3. `/productivity:task-management` — convert spec into TASKS.md items

### Phase 2 — Architecture (before implementation)

1. `/engineering:architecture` — first feature always; repeat when data model changes
2. `/feature-dev:feature-dev` Phases 1–4 — discovery through architecture design
3. **Record the decision in `docs/decisions.md` before writing code**

### Phase 3 — Implementation

1. `/feature-dev:feature-dev` Phase 5
2. `/frontend-design:frontend-design` for UI components
3. Run `/simplify` manually before wrapping up (not a hook — see Active Hooks below)

### Phase 4 — Pre-merge Review (REQUIRED before gh pr create)

1. Follow `docs/runbooks/pr-workflow.md`: run `pnpm preflight`
   (`preflight` includes `pnpm qa:guards` — the same QA Guards check CI runs).
   No version bump — the deploy workflow derives the version at merge (ADR-017).
2. Document as appropriate (the Pre-PR docs gate hook will remind you):
   - Technical decisions → `docs/adrs/<slug>.md` + row in `docs/decisions.md`
   - Spec changes → `docs/specs/<slug>.md`
   - System operations (scripts, infra, env setup) → `docs/runbooks/<slug>.md`
3. `/pr-review-toolkit:review-pr all` — address all Critical issues first
4. Work through `docs/runbooks/qa-checklist.md` — the PR template prefills the `[attest]`
   items; the `[auto]` items are enforced by the QA Guards CI check (`pnpm qa:guards`)

### Phase 5 — Merge and Deploy

1. `gh pr create` — then run `/pr-review-toolkit:review-pr all` and `/productivity:update` manually
2. Merge to `main` → GitHub Actions auto-deploys to **dev** and tags the version (`docs/runbooks/cicd-setup.md`)
3. Promote to **prod** via the **Promote** workflow (`.github/workflows/promote.yml`) by version tag, or `cdk deploy --all -c env=prod` (`docs/runbooks/prod-domain-setup.md`)

### Phase 6 — Post-Ship

- Run `/productivity:update` to mark tasks done
- `/engineering:tech-debt` — monthly
- `/engineering:documentation` — when public behavior changes
- `/product-management:roadmap-update` — after each feature ships

## Code Review Checklist

The code-reviewer subagents (used by feature-dev and pr-review-toolkit) read this section.

The canonical, PR-facing version lives in `docs/runbooks/qa-checklist.md` and is mirrored as
checkboxes in `.github/pull_request_template.md`. Items marked `[auto]` there are enforced
mechanically by `pnpm qa:guards` (`scripts/qa-guards.mjs`) via the **QA Guards** CI check, which
blocks merge — so the list below is the rationale; the gate is in CI. Keep the three in sync.

### General

- No console.log in production code — the `no-console` QA guard blocks `console.log`/`info`/`debug`; server metrics use `process.stdout.write` for CloudWatch EMF (see `apps/api/src/lib/metrics.ts`)
- Error boundaries on all async operations
- Client analytics: use `track()` from `apps/web/src/lib/analytics.ts` (fire-and-forget) → `POST /v1/events`; to add an event, add its name to **both** the client `AnalyticsEvent` union and the server `ALLOWED_EVENTS` allowlist (ADR-016)
- Environment variables for all external service credentials
- **[NON-NEGOTIABLE] Never add mock/stub auth** — `VITE_MOCK_API`, fake `getCurrentUser()` returns, or any bypass of Cognito authentication. Auth always runs against the real dev Cognito pool. Flag any `MOCK_MODE` guard in `lib/auth.ts` or `main.tsx` as a blocker.

### Bookshelf Domain

- ISBN input: validated (length 10 or 13, check digit correct)
- ASIN input: alphanumeric, 1–20 chars (`/^[A-Za-z0-9]{1,20}$/`) — see endpoint checklist for rationale
- Book API calls: error boundary + fallback UI required
- Wishlist vs. Owned: states are distinct, never conflated in the same data structure
- Zero-books state: empty shelf handled in all list views
- Duplicate detection: ISBN/ASIN checked before adding a book
- Cover images: broken-image fallback on all external CDN URLs

### UI / Design System

- Buttons: always use `<Button>` from `src/components/ui/Button.tsx` — never inline `bg-indigo-600` or `bg-gray-900` button classes on a raw `<button>`
- Informational callouts/tips: use `<Callout>` from `src/components/ui/Callout.tsx` (not for form validation — use inline red/green); QR codes via `<QrCode>` (lazy-loaded, always dark-on-white). See `docs/design-system.md`
- Auth form inputs/labels: import `inputClass`/`labelClass` from `src/lib/form-styles.ts` — never redeclare locally
- Muted/secondary text: minimum `text-gray-500 dark:text-zinc-400` for any visible text content on light backgrounds (`text-gray-400` fails WCAG AA contrast)
- Interactive elements: no hover-only affordances (e.g. `opacity-0 group-hover:opacity-100`) — touch users can't hover
- Loading spinners (`animate-spin`): must include `role="status"` and `aria-label`
- State communicated by color alone (e.g. checklists, badges): must also use a shape/icon distinction for color-blind users

### Security

- **[NON-NEGOTIABLE] Environment variables must NEVER be committed to source control** — not in `.env`, `launch.json`, config files, or anywhere else. Use `.env.local` (gitignored) for local values; load them at runtime via `--env-file`, SSM, or equivalent. If a secret is already committed, treat it as compromised and rotate it.
- No hardcoded API keys or secrets anywhere in source
- ISBN/ASIN from user input sanitized before external API calls

#### New endpoint checklist (required before merging any new route)

**Input validation**

- Every path parameter must be validated (format + allowlist where applicable) — never pass raw path params to DynamoDB keys or external APIs; return 400 on failure
- Every free-text query string must have a max-length check (e.g. `q` ≤ 200 chars); forwarding unbounded strings to external APIs is a DoS vector
- Every text field written to DynamoDB must have a maximum length cap — add it as a named constant near the write site (e.g. `NOTES_MAX_LENGTH = 2000`); this includes `BookMetadata` fields (`title`, `description`, `coverUrl`, author names) — sanitize via the `sanitizeBookMetadata` helper in `shelf.ts` before every `putBookMetadata` call
- Use `isValidIsbn` / `normalizeIsbn` from `lib/isbn.ts` (checksum-validated) — never write a local digit-only ISBN check in a route file
- ASIN format: `/^[A-Za-z0-9]{1,20}$/` — the provider falls back to keyword search so garbage strings waste quota and pollute logs
- Pagination cursors must be validated to decode as a non-null, non-array JSON object; return **400** (not 500) on failure — catch `InvalidCursorError` from `lib/dynamo.ts`
- Body size: a global `bodyLimit` middleware in the app entry point covers all routes — do not remove it; if a specific route needs a tighter cap, add a per-route `bodyLimit` before the handler

**Auth**

- All routes except `GET /health` must use `authMiddleware` — apply it at the router level (`router.use("*", authMiddleware)`), not per-route
- Any new unauthenticated endpoint that proxies an external API is a rate-limiting target; note it in the backlog for WAF coverage (see rate-limiting task in `todo/TASKS.md`)

**Shared data**

- The `BOOK#${isbn}` metadata cache is keyed by ISBN only (not by user) — any authenticated user can overwrite it; never store user-controlled free text in shared keys

**Error responses**

- 500 responses must never include raw exception messages or stack traces — use generic strings and log the real error server-side with `console.error`
- Be precise about status codes: malformed input → 400, not found → 404, duplicate → 409, bad upstream → 502

## Active Hooks

These are the hooks **actually configured** in `.claude/settings.json` and via hookify rules
(`.claude/hookify.*.local.md`):

| Hook              | Source / Event               | Trigger                      | Action                                               |
| ----------------- | ---------------------------- | ---------------------------- | ---------------------------------------------------- |
| Worktree env copy | settings.json / SessionStart | New session (`startup`)      | Copy `.env.local` into worktree, then `pnpm install` |
| Pre-PR docs gate  | settings.json / PreToolUse   | `gh pr create`               | Echo docs-update reminder (non-blocking)             |
| Sensitive files   | hookify                      | `.env`/secret edits          | Warn                                                 |
| No env in source  | hookify                      | env values written to source | Warn                                                 |
| ISBN reminder     | hookify                      | "isbn" in new text           | Warn                                                 |
| Hardcoded data    | hookify                      | ISBN/ASIN literals in source | Warn                                                 |

The `/productivity:*`, `/simplify`, and `/pr-review-toolkit:review-pr` steps in the workflow above
are run **manually** as slash commands — they are intentionally **not** wired as hooks. Per the
global hook-safety rule, a hook command must never start with `claude` (it would re-enter Claude
Code and fork-bomb). QA enforcement that must be automatic lives in **CI** (the QA Guards check),
not in a Stop/PostToolUse hook.

## Documentation Index

Full details in `docs/` — read on demand, not every session:

- `docs/decisions.md` — all architecture, design, and implementation decisions (canonical reference)
- `todo/TASKS.md` — Active, Backlog, Done (the single task list — see "Task List" above)
- `docs/specs/` — feature specifications
- `docs/adrs/` — full ADR documents
- `docs/runbooks/` — operational guides
- `memory/projects/bookshelf.md` — project overview
