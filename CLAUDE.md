# Bookshelf — Session Contract

## About

Solo developer. Web app for users to track books they own and want to read.
Tech stack: TBD — run `/engineering:architecture` before first implementation.
Deployment target: TBD (Vercel plugin is disabled until decided).

## Mandatory Session Start

Always begin every session with `/productivity:start`.
No implementation work begins before running this skill.

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
3. **Document the decision in "Architecture Decisions" below before writing code**

### Phase 3 — Implementation
1. `/feature-dev:feature-dev` Phase 5
2. `/frontend-design:frontend-design` for UI components
3. `/simplify` fires automatically via Stop hook at end of each session turn

### Phase 4 — Pre-merge Review (REQUIRED before gh pr create)
1. Document as appropriate (hook will remind you):
   - Technical decisions → `docs/adrs/<slug>.md`
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

### Security
- No hardcoded API keys or secrets anywhere in source
- ISBN/ASIN from user input sanitized before external API calls

## Active Hooks

| Hook | Event | Trigger | Action | Async |
|------|-------|---------|--------|-------|
| Productivity start | SessionStart (project) | New session (`startup`) | `claude /productivity:start` | yes |
| /simplify | Stop (project) | End of session turn | `claude --print /simplify` | yes |
| Pre-PR docs gate | PreToolUse (project) | `gh pr create` | echo docs checklist | no |
| PR review | PostToolUse (project) | `gh pr create` | `/pr-review-toolkit:review-pr all` | yes |
| Productivity (PR) | PostToolUse (project) | `gh pr create` | `/productivity:update` | yes |
| Docs reminder | PostToolUse (project) | Edit/Write | echo docs-check | no |
| Session end | Stop (project) | Always | `/productivity:update` | yes |
| Sensitive files | hookify | .env/secrets edits | warn | no |
| ISBN reminder | hookify | "isbn" in new text | warn | no |
| Hardcoded data | hookify | ISBN/ASIN literals in source | warn | no |

## Architecture Decisions

| Decision | Choice | Rationale | Date |
|----------|--------|-----------|------|
| Frontend | React SPA (Vite) → S3 + CloudFront | Auth-gated app; no SSR needed; API stays fully standalone for MCP | 2026-05-14 |
| Backend API | Hono on Lambda + API Gateway HTTP API | Lightweight TS framework; CDK-native; co-deploys with infra | 2026-05-14 |
| Database | DynamoDB on-demand | Permanent free tier; scales to zero; access patterns fit single-table design | 2026-05-14 |
| Auth | Amazon Cognito User Pools | AWS-native; 10k MAU free; JWKS JWT works across Lambda + MCP without coordination | 2026-05-14 |
| Deployment | AWS CDK (3 stacks: Auth, API, Web) | Full transparency; no Amplify abstraction; showcases CDK | 2026-05-14 |
| CI/CD | GitHub Actions — `cdk synth` on PR; deploy on semver tag | Fast feedback on infra changes; versioned artifacts for rollback | 2026-05-14 |
| Package manager | pnpm workspaces monorepo | `apps/api`, `apps/mcp`, `apps/web`, `packages/infra` as separate packages | 2026-05-14 |
| ADR | `docs/adrs/001-tech-stack.md` | Full decision record with options considered and cost analysis | 2026-05-14 |
| Shelf API shape | Paginated inline book metadata (`GET /v1/shelf`) | MCP tools need full data in one call; cursor pagination maps to DynamoDB `LastEvaluatedKey` | 2026-05-15 |

## Memory and Documentation Files

- `docs/TASKS.md` — Active, Backlog, Done
- `docs/specs/` — Feature specifications (one file per feature)
- `docs/adrs/` — Architecture Decision Records (one per technical decision)
- `docs/runbooks/` — System operations: scripts, infra setup, env configuration
- `docs/notes/` — Session logs, miscellaneous
- `memory/glossary.md` — Term definitions
- `memory/projects/bookshelf.md` — Project overview

## Glossary

| Term | Meaning |
|------|---------|
| ISBN | International Standard Book Number (13-digit modern, 10-digit legacy) |
| ASIN | Amazon Standard Identification Number (for books: often matches ISBN-10) |
| Owned | A book the user physically possesses |
| Want | A book on the user's wishlist |
