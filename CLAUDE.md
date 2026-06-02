# Bookshelf — Session Contract

## About

Solo developer. Web app for users to track books they own and want to read.
Tech stack: Hono on Lambda + DynamoDB + Cognito + React SPA — see `docs/adrs/001-tech-stack.md`.
Deployment target: AWS (CDK) — dev environment live; see `docs/runbooks/cicd-setup.md`.

## Mandatory Session Start

Always begin every session with `/productivity:start`.
No implementation work begins before running this skill.

## Worktree Setup (new worktrees only)

When opening a session inside a git worktree (path contains `.claude/worktrees/`), run the setup script before any dev work:

```powershell
.\scripts\worktree-setup.ps1
```

This copies `apps/api/.env.local` and `apps/web/.env.local` from the main worktree (`G:\source\bookshelf`). Without these files neither the API nor the frontend can connect to Cognito or DynamoDB.

If the script reports nothing to copy (files already exist), proceed normally.
If the main worktree path differs, pass it: `.\scripts\worktree-setup.ps1 -MainWorktree "C:\path\to\bookshelf"`.

**After setup, choose a dev mode** — see `docs/runbooks/local-dev.md`:

- **Frontend work only** → `pnpm --filter @bookshelf/web dev:mock` (no Docker needed)
- **API or full-stack work** → `docker compose up -d` then start both servers normally

## Workflow: Idea to Production

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
3. `/simplify` fires automatically via Stop hook at end of each session turn

### Phase 4 — Pre-merge Review (REQUIRED before gh pr create)

1. Document as appropriate (hook will remind you):
   - Technical decisions → `docs/adrs/<slug>.md` + row in `docs/decisions.md`
   - Spec changes → `docs/specs/<slug>.md`
   - System operations (scripts, infra, env setup) → `docs/runbooks/<slug>.md`
2. `/pr-review-toolkit:review-pr all` — address all Critical issues first
3. `/engineering:deploy-checklist`

### Phase 5 — Merge and Deploy

1. `gh pr create` — hook auto-fires PR review + productivity update
2. `/vercel:deploy` — preview deployment first (enable Vercel plugin before this)
3. `/vercel:deploy prod` — production (requires explicit confirmation)
4. `/productivity:update` — mark tasks Done

### Phase 6 — Post-Ship

- Stop hook fires `/productivity:update` automatically
- `/engineering:tech-debt` — monthly
- `/engineering:documentation` — when public behavior changes
- `/product-management:roadmap-update` — after each feature ships

## Code Review Checklist

The code-reviewer subagents (used by feature-dev and pr-review-toolkit) read this section.

### General

- No console.log in production code
- Error boundaries on all async operations
- Environment variables for all external service credentials

### Bookshelf Domain

- ISBN input: validated (length 10 or 13, check digit correct)
- ASIN input: opaque string (non-empty check only)
- Book API calls: error boundary + fallback UI required
- Wishlist vs. Owned: states are distinct, never conflated in the same data structure
- Zero-books state: empty shelf handled in all list views
- Duplicate detection: ISBN/ASIN checked before adding a book
- Cover images: broken-image fallback on all external CDN URLs

### UI / Design System

- Buttons: always use `<Button>` from `src/components/ui/Button.tsx` — never inline `bg-indigo-600` or `bg-gray-900` button classes on a raw `<button>`
- Auth form inputs/labels: import `inputClass`/`labelClass` from `src/lib/form-styles.ts` — never redeclare locally
- Muted/secondary text: minimum `text-gray-500 dark:text-zinc-400` for any visible text content on light backgrounds (`text-gray-400` fails WCAG AA contrast)
- Interactive elements: no hover-only affordances (e.g. `opacity-0 group-hover:opacity-100`) — touch users can't hover
- Loading spinners (`animate-spin`): must include `role="status"` and `aria-label`
- State communicated by color alone (e.g. checklists, badges): must also use a shape/icon distinction for color-blind users

### Security

- **[NON-NEGOTIABLE] Environment variables must NEVER be committed to source control** — not in `.env`, `launch.json`, config files, or anywhere else. Use `.env.local` (gitignored) for local values; load them at runtime via `--env-file`, SSM, or equivalent. If a secret is already committed, treat it as compromised and rotate it.
- No hardcoded API keys or secrets anywhere in source
- ISBN/ASIN from user input sanitized before external API calls

## Active Hooks

| Hook               | Event                  | Trigger                      | Action                             | Async |
| ------------------ | ---------------------- | ---------------------------- | ---------------------------------- | ----- |
| Productivity start | SessionStart (project) | New session (`startup`)      | `claude /productivity:start`       | yes   |
| /simplify          | Stop (project)         | End of session turn          | `claude --print /simplify`         | yes   |
| Pre-PR docs gate   | PreToolUse (project)   | `gh pr create`               | echo docs checklist                | no    |
| PR review          | PostToolUse (project)  | `gh pr create`               | `/pr-review-toolkit:review-pr all` | yes   |
| Productivity (PR)  | PostToolUse (project)  | `gh pr create`               | `/productivity:update`             | yes   |
| Docs reminder      | PostToolUse (project)  | Edit/Write                   | echo docs-check                    | no    |
| Session end        | Stop (project)         | Always                       | `/productivity:update`             | yes   |
| Sensitive files    | hookify                | .env/secrets edits           | warn                               | no    |
| ISBN reminder      | hookify                | "isbn" in new text           | warn                               | no    |
| Hardcoded data     | hookify                | ISBN/ASIN literals in source | warn                               | no    |

## Documentation Index

Full details in `docs/` — read on demand, not every session:

- `docs/decisions.md` — all architecture, design, and implementation decisions (canonical reference)
- `docs/TASKS.md` — Active, Backlog, Done
- `docs/specs/` — feature specifications
- `docs/adrs/` — full ADR documents
- `docs/runbooks/` — operational guides
- `memory/projects/bookshelf.md` — project overview
