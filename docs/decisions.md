# Decisions

Quick-reference index of all architecture, design, and implementation decisions.
Full ADR documents are in `docs/adrs/`.

## Architecture Decisions

| Decision             | Choice                                                   | Rationale                                                                                                                                                  | Date       |
| -------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Frontend             | React SPA (Vite) → S3 + CloudFront                       | Auth-gated app; no SSR needed; API stays fully standalone for MCP                                                                                          | 2026-05-14 |
| Backend API          | Hono on Lambda + API Gateway HTTP API                    | Lightweight TS framework; CDK-native; co-deploys with infra                                                                                                | 2026-05-14 |
| Database             | DynamoDB on-demand                                       | Permanent free tier; scales to zero; access patterns fit single-table design                                                                               | 2026-05-14 |
| Auth                 | Amazon Cognito User Pools                                | AWS-native; 10k MAU free; JWKS JWT works across Lambda + MCP without coordination                                                                          | 2026-05-14 |
| Deployment           | AWS CDK (3 stacks: Auth, API, Web)                       | Full transparency; no Amplify abstraction; showcases CDK                                                                                                   | 2026-05-14 |
| CI/CD                | GitHub Actions — `cdk synth` on PR; deploy on semver tag | Fast feedback on infra changes; versioned artifacts for rollback                                                                                           | 2026-05-14 |
| Package manager      | pnpm workspaces monorepo                                 | `apps/api`, `apps/mcp`, `apps/web`, `packages/infra` as separate packages                                                                                  | 2026-05-14 |
| Shelf API shape      | Paginated inline book metadata (`GET /v1/shelf`)         | MCP tools need full data in one call; cursor pagination maps to DynamoDB `LastEvaluatedKey` — see `docs/adrs/002-shelf-api-response-shape.md`              | 2026-05-15 |
| Smoke tests          | Vitest suite in `test/smoke/`; runs post-deploy in CI    | Gates version tag on live-API verification; auto-rollback to last good tag on failure — see `docs/adrs/003-post-deploy-smoke-tests.md`                     | 2026-05-31 |
| Web auth library     | `@aws-amplify/auth` (isolated behind `lib/auth.ts`)      | Lowest implementation effort to unblock E2E testing; 2-way door — swappable by rewriting one file — see `docs/adrs/004-web-auth-library.md`                | 2026-05-31 |
| SSM secret retrieval | Lambda Powertools `SSMProvider` with 7-day TTL cache     | Fetches SecureString at invocation time; avoids CDK synth-time account constraints; built-in caching — see `docs/adrs/005-lambda-powertools-parameters.md` | 2026-06-01 |
| Dev auth access      | Invitation-only (`selfSignUpEnabled: false` in dev)      | Prevents strangers from self-registering on dev infra; `allowSelfSignUp` CDK prop flips it on for prod; invite via `docs/runbooks/invite-dev-user.md`      | 2026-06-01 |

## UI / Design System Decisions

| Decision           | Choice                                                                           | Rationale                                                                                                       | Date       |
| ------------------ | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------- |
| Button primitive   | `src/components/ui/Button.tsx` with `variant`/`size`/`loading` props             | Single source of truth for all button styles; prevents silent style drift across pages                          | 2026-06-02 |
| Button color split | Auth → `variant="primary"` (indigo-600); app → `variant="app"` (gray-900/white)  | Intentional: indigo is the brand entry point; gray-900 is the neutral in-app style; both route through `Button` | 2026-06-02 |
| Shared form styles | `src/lib/form-styles.ts` exports `inputClass` / `labelClass`                     | All auth inputs share one definition; eliminates copy-paste drift across 5 auth pages                           | 2026-06-02 |
| Muted text floor   | `text-gray-500 dark:text-zinc-400` minimum for visible text on light backgrounds | `text-gray-400` on white = ~2.8:1, fails WCAG AA; gray-500 = ~4.6:1, passes. Placeholder text (exempt) may stay | 2026-06-02 |
| Shelf card actions | Always visible (no hover-only reveal)                                            | `opacity-0 group-hover:opacity-100` is invisible on touch devices                                               | 2026-06-02 |
| Loading spinners   | `role="status"` + `aria-label="Loading"` required on all `animate-spin` elements | Screen readers need to announce loading state                                                                   | 2026-06-02 |
| PasswordChecklist  | Unmet rules use `○` prefix; met rules use `✓`                                    | Shape must distinguish state, not color alone — color-blind users cannot distinguish gray `·` from green `✓`    | 2026-06-02 |

## Glossary

| Term  | Meaning                                                                  |
| ----- | ------------------------------------------------------------------------ |
| ISBN  | International Standard Book Number (13-digit modern, 10-digit legacy)    |
| ASIN  | Amazon Standard Identification Number (for books: often matches ISBN-10) |
| Owned | A book the user physically possesses                                     |
| Want  | A book on the user's wishlist                                            |
