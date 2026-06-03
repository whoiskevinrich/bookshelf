# Tasks

## Active

- [ ] Merge PR #13 — smoke test fixes (SSM API key injection, ISBN validation, infra tsconfig, Powertools caching)
- [ ] After merge: verify CI deploy passes all 11 smoke tests in dev
- [ ] Deploy invitation-only dev auth — `cdk deploy BookshelfAuth` (dev, no `-c allowSelfSignUp`); redeploy is non-breaking, existing accounts are preserved

## Backlog

### Phase 2 — API (remaining)

- [ ] Deploy to dev; smoke-test all endpoints (`API_BASE_URL=<url> pnpm test:smoke`)

### Phase 3 — MCP server

- [ ] Write MCP spec (`docs/specs/mcp-server.md`) before starting
- [ ] Scaffold `apps/mcp` (`@modelcontextprotocol/sdk`)
- [ ] Implement `lib/api-client.ts` — typed wrapper for all `/v1/` endpoints (handles pagination)
- [ ] Implement `tools/shelf.ts` — `get_shelf`, `add_to_shelf`, `update_shelf_status`, `remove_from_shelf`
- [ ] Implement `tools/books.ts` — `search_books`
- [ ] Test with MCP inspector; verify `get_shelf` returns usable inline data in one call
- [ ] Write unit tests for all tools

### Dark Mode

- [x] Define CSS color tokens in `index.css` (light + dark via `.dark` class on `<html>`)
- [x] Implement `useTheme` hook — localStorage persistence + `prefers-color-scheme` detection
- [x] Add theme toggle button to `AppHeader` (sun/moon icon)
- [x] Audit and update all components to use semantic token classes (remove hard-coded light-only utilities)
- [x] QA: verify all pages in both themes at mobile and desktop widths

### Phase 4 — Web UI (remaining)

- [ ] Implement `lib/api-client.ts` — typed client for `/v1/` endpoints
- [ ] Build demo shelf component — read-only, hard-coded seed data (10 Sci-Fi/Fantasy books)
  - Owned section: Dune, Neuromancer, The Left Hand of Darkness, Project Hail Mary, The Name of the Wind
  - Want section: The Way of Kings, The Fifth Season, Children of Time, A Fire Upon the Deep, Piranesi
  - Broken-image fallback on all cover `<img>` tags
- [ ] Build landing page (`/`) — demo shelf + "Sign up to build your shelf" CTA
- [ ] Build book search component — debounced title/author search, ISBN/ASIN direct entry, ISBN validation
- [ ] Build shelf page (`/shelf`) — Owned section, Want section, empty states, add/move/remove actions
- [ ] Build wishlist page (`/wishlist`) — Want section only view
- [ ] Implement optimistic UI for add/move/remove mutations (TanStack Query)
- [ ] Implement pagination for `GET /v1/shelf` — load-more or infinite scroll
- [ ] Write component unit tests (Vitest + RTL)
- [ ] Write E2E tests (Playwright): sign-up → search → add → view shelf → move → remove

### Phase 5 — CI/CD

- [ ] Configure GitHub Actions variables: `AWS_ROLE_ARN_DEV`, `AWS_ROLE_ARN_PROD`, `AWS_REGION` (no long-lived keys — OIDC)

### Future (post-v1)

- [ ] Configure SES as Cognito email sender — improves deliverability, eliminates spam-folder issues; see `docs/runbooks/auth-troubleshooting.md#ses-upgrade-path`
- [ ] Visual polish P2 — Shelf carousel: horizontally scrollable cover carousel on desktop (≥ md), prev/next arrow controls, scroll-snap; requires a cover detail view and roving-tabindex a11y — write a separate spec before starting; see `docs/specs/visual-polish.md`

## Done

- [x] Define a process to implement the bookshelf project using available skills
- [x] Run `/engineering:architecture` to decide tech stack and deployment target — see `docs/adrs/001-tech-stack.md`
- [x] Write feature spec — core shelf — see `docs/specs/core-shelf.md`
- [x] Add ADR-002: shelf API response shape (paginated inline metadata) — see `docs/adrs/002-shelf-api-response-shape.md`
- [x] Init pnpm workspace root (`pnpm-workspace.yaml`, root `package.json`, `tsconfig.base.json`)
- [x] Scaffold `packages/infra` CDK app (cdk.json, bin/bookshelf.ts, vitest config, CDK deps)
- [x] Write `AuthStack` — Cognito User Pool + App Client + SSM params (19/19 CDK tests passing)
- [x] Write `ApiStack` — DynamoDB single table + Lambda placeholder + API Gateway HTTP API + SSM params
- [x] Write `WebStack` — S3 bucket + CloudFront distribution + OAC + versioned-prefix routing + SSM params
- [x] Write CI/CD pipeline spec — see `docs/specs/cicd-pipeline.md`
- [x] Write `.github/workflows/ci.yml` — lint, format, unit tests, CDK synth, unique version gate
- [x] Write `.github/workflows/deploy.yml` — auto-deploy to dev on merge to main; git tag on success
- [x] Write `.github/workflows/promote.yml` — `workflow_dispatch` promotion to prod by mission tag
- [x] Write `.github/workflows/version-bump.yml` — `workflow_dispatch` patch/minor/major bump; opens PR
- [x] Write `docs/runbooks/cicd-setup.md` — OIDC roles, GitHub variables, branch protection, troubleshooting
- [x] Write `docs/runbooks/rollback.md` — Lambda alias swap, CloudFront origin path, DynamoDB PITR, decision tree
- [x] `cdk deploy --all` to dev environment
- [x] Scaffold `apps/api` (pnpm init, Hono, AWS Lambda adapter, esbuild)
- [x] Implement `lib/books/types.ts` — `BookProvider` + `BookSearchResult` interfaces
- [x] Implement `lib/books/providers/google-books.ts`
- [x] Implement `lib/books/providers/index.ts` — registry + `getActiveProvider()`
- [x] Implement `lib/books/search.ts` — `searchBooks()`, `getBookByIsbn()`, `getBookByAsin()`
- [x] Implement `lib/dynamo.ts` — DynamoDB DocumentClient + shelf CRUD helpers
- [x] Implement `middleware/auth.ts` — Cognito JWKS JWT verification
- [x] Implement `GET /v1/books/search` route — proxy to active book provider
- [x] Implement `GET /v1/shelf` route — paginated inline book metadata (see ADR-002)
- [x] Implement `POST /v1/shelf` route — add book; 409 on duplicate
- [x] Implement `PATCH /v1/shelf/{isbn}` route — update status (owned ↔ want)
- [x] Implement `DELETE /v1/shelf/{isbn}` route — remove entry
- [x] Update `ApiStack` Lambda to use built asset (`apps/api/dist`)
- [x] Write unit tests for route handlers (mocked DynamoDB + auth)
- [x] Write unit tests for book provider adapter (mocked HTTP)
- [x] Write unit tests for JWT middleware
- [x] Write auth spec — `docs/specs/authentication.md`
- [x] Write ADR-004 — web auth library decision (`@aws-amplify/auth`) — see `docs/adrs/004-web-auth-library.md`
- [x] Scaffold `apps/web` (Vite + React TS, Tailwind v4, `@aws-amplify/auth`)
- [x] Implement `lib/auth.ts` — Amplify Auth v6 wrapper with Cognito error mapping
- [x] Implement `AuthContext` + `ProtectedRoute`
- [x] Build auth pages — `/auth/login`, `/auth/signup`, `/auth/verify`, `/auth/forgot-password`, `/auth/reset-password`
- [x] Write `docs/runbooks/auth-troubleshooting.md`
- [x] Write integration tests against DynamoDB Local (`apps/api/test/integration/dynamo.test.ts`)
- [x] Write ISBN cover validation script (`apps/api/scripts/validate-covers.ts`)
