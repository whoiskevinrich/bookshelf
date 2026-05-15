# Tasks

## Active

### Phase 1 — Workspace + Infra scaffold
- [ ] Init pnpm workspace root (`pnpm-workspace.yaml`, root `package.json`, `tsconfig.base.json`)
- [ ] Scaffold `packages/infra` CDK app
- [ ] Write `AuthStack` — Cognito User Pool + App Client
- [ ] Write `ApiStack` — DynamoDB single table + Lambda placeholder + API Gateway HTTP API
- [ ] Write `WebStack` — S3 bucket + CloudFront distribution + OAC
- [ ] `cdk deploy --all` to dev environment; confirm all resources in AWS console

## Backlog

### Phase 2 — API (primary deliverable)
- [ ] Scaffold `apps/api` (pnpm init, Hono, AWS Lambda adapter, esbuild)
- [ ] Implement `lib/books/types.ts` — `BookProvider` + `BookSearchResult` interfaces
- [ ] Implement `lib/books/providers/google-books.ts`
- [ ] Implement `lib/books/providers/index.ts` — registry + `getActiveProvider()`
- [ ] Implement `lib/books/search.ts` — `searchBooks()`, `getBookByIsbn()`, `getBookByAsin()`
- [ ] Validate demo shelf ISBNs against Google Books API (confirm all 10 have cover images)
- [ ] Implement `lib/dynamo.ts` — DynamoDB DocumentClient + shelf CRUD helpers
- [ ] Implement `middleware/auth.ts` — Cognito JWKS JWT verification
- [ ] Implement `GET /v1/books/search` route — proxy to active book provider
- [ ] Implement `GET /v1/shelf` route — paginated inline book metadata (see ADR-002)
  - Cursor-based pagination via DynamoDB `LastEvaluatedKey`
  - `BatchGetItem` for book metadata per page
  - Optional `?status=owned|want` filter
  - Default page size 20, max 100
- [ ] Implement `POST /v1/shelf` route — add book; 409 on duplicate
- [ ] Implement `PATCH /v1/shelf/{isbn}` route — update status (owned ↔ want)
- [ ] Implement `DELETE /v1/shelf/{isbn}` route — remove entry
- [ ] Add Lambda function to `ApiStack`; deploy; smoke-test all endpoints with curl
- [ ] Write unit tests for route handlers (mocked DynamoDB + auth)
- [ ] Write unit tests for book provider adapter (mocked HTTP)
- [ ] Write unit tests for JWT middleware
- [ ] Write integration tests against DynamoDB Local

### Phase 3 — MCP server
- [ ] Write MCP spec (`docs/specs/mcp-server.md`) before starting
- [ ] Scaffold `apps/mcp` (`@modelcontextprotocol/sdk`)
- [ ] Implement `lib/api-client.ts` — typed wrapper for all `/v1/` endpoints (handles pagination)
- [ ] Implement `tools/shelf.ts` — `get_shelf`, `add_to_shelf`, `update_shelf_status`, `remove_from_shelf`
- [ ] Implement `tools/books.ts` — `search_books`
- [ ] Test with MCP inspector; verify `get_shelf` returns usable inline data in one call
- [ ] Write unit tests for all tools

### Phase 4 — Web UI
- [ ] Scaffold `apps/web` (`pnpm create vite web --template react-ts`)
- [ ] Install Tailwind v4 + shadcn/ui + aws-amplify
- [ ] Implement `lib/auth.ts` — Cognito sign-up / sign-in / sign-out via Amplify Auth
- [ ] Implement `lib/api-client.ts` — typed client for `/v1/` endpoints
- [ ] Build demo shelf component — read-only, hard-coded seed data (10 Sci-Fi/Fantasy books)
  - Owned section: Dune, Neuromancer, The Left Hand of Darkness, Project Hail Mary, The Name of the Wind
  - Want section: The Way of Kings, The Fifth Season, Children of Time, A Fire Upon the Deep, Piranesi
  - Broken-image fallback on all cover `<img>` tags
- [ ] Build landing page (`/`) — demo shelf + "Sign up to build your shelf" CTA
- [ ] Build auth pages — `/auth/login`, `/auth/signup`
- [ ] Build book search component — debounced title/author search, ISBN/ASIN direct entry, ISBN validation
- [ ] Build shelf page (`/shelf`) — Owned section, Want section, empty states, add/move/remove actions
- [ ] Build wishlist page (`/wishlist`) — Want section only view
- [ ] Implement optimistic UI for add/move/remove mutations (TanStack Query)
- [ ] Implement pagination for `GET /v1/shelf` — load-more or infinite scroll
- [ ] Write component unit tests (Vitest + RTL)
- [ ] Write E2E tests (Playwright): sign-up → search → add → view shelf → move → remove

### Phase 5 — CI/CD
- [ ] Write `.github/workflows/ci.yml` — lint + type-check + tests + `cdk synth` on PR
- [ ] Write `.github/workflows/deploy.yml` — semver-tagged deploy to all three CDK stacks
- [ ] Write `docs/runbooks/rollback.md` — per-layer rollback procedures (Lambda, CloudFront/S3)
- [ ] Configure GitHub Actions secrets (AWS credentials, Cognito IDs, Google Books API key)

## Done

- [x] Define a process to implement the bookshelf project using available skills
- [x] Run `/engineering:architecture` to decide tech stack and deployment target — see `docs/adrs/001-tech-stack.md`
- [x] Write feature spec — core shelf — see `docs/specs/core-shelf.md`
- [x] Add ADR-002: shelf API response shape (paginated inline metadata) — see `docs/adrs/002-shelf-api-response-shape.md`
