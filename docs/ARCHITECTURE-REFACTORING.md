# Architecture Refactoring Summary

This document explains the recent refactoring of `packages/infra` to reduce duplication and improve maintainability.

## What Changed

### 1. WebHosting Construct (`lib/hosting-construct.ts`)

**Problem**: CloudFront + S3 + BucketDeployment logic was duplicated and tightly coupled to WebStack.

**Solution**: Extracted into a reusable `WebHosting` construct that encapsulates:
- S3 bucket with origin access control (OAC)
- CloudFront distribution with SPA routing (404 → index.html)
- CloudFront Function for same-origin `/api/*` rewriting (if apiOrigin is set)
- BucketDeployment with versioned S3 prefix
- Runtime config (config.json) generation and S3 upload
- Custom domain support (optional cert + Route53 alias)
- SSM parameter outputs for the deployed CDN domain

**Usage in WebStack**: WebStack now instantiates WebHosting and passes through its props, reducing WebStack from ~280 to ~70 lines.

### 2. Environment Setup Helper (`lib/environment-setup.ts`)

**Problem**: Custom domain orchestration (DnsStack → CdnCertStack → AssetsStack → config objects) was duplicated across `bin/bookshelf.ts` and future pipeline code.

**Solution**: Created `setupCustomDomain()` function that:
- Creates DnsStack (Route53 hosted zone for the app subdomain)
- Creates CdnCertStack (ACM cert in us-east-1 for CloudFront)
- Creates AssetsStack (S3 bucket for web asset versioning in prod)
- Returns optional configs for Api/Web stacks to consume

**Usage in bin/bookshelf.ts**: Replaced ~28 lines of nested conditionals with a single function call:
```typescript
const { dns, cdnCert, assets, webCustomDomain, apiCustomDomain } = setupCustomDomain(
  app,
  config.domain,
  usEast1Env,
  env,
);
```

### 3. Optional CDK Pipeline (`lib/pipeline-stack.ts`, `bin/pipeline.ts`)

**Problem**: GitHub Actions workflows required manual GitHub OIDC setup and are not self-documenting through code.

**Solution**: Added optional CDK Pipeline for AWS-native deployment orchestration:
- Source: GitHub main branch (and release tags for prod)
- Build: `pnpm build` + `cdk synth`
- Dev Stage: automatic deployment
- Prod Stage: manual approval gate

**Usage**: Alternative to GitHub Actions (not in addition to). Choose one or the other.

### Pipeline Decision

- The repository uses **GitHub Actions as the primary pipeline** by default (`.github/workflows/deploy.yml` + `promote.yml`). The CDK Pipeline is available as an optional, AWS-native alternative. Do not run both concurrently — disable the GitHub deploy workflows before switching to the CDK Pipeline to avoid context injection and concurrent-deploy conflicts.

### 4. Deploy Orchestration Script (`scripts/deploy-env.js`)

**Problem**: `deploy.yml` and `promote.yml` workflows duplicated 6 deployment steps each (Build API/MCP, create web dist stub, deploy Auth/API/MCP, resolve outputs, build web, deploy Web).

**Solution**: Created `deploy-env.js` Node.js script that orchestrates the entire sequence:
- Single source of truth for deployment logic
- Reusable from both GitHub Actions and CDK Pipelines
- Eliminates workflow duplication

**Usage in CI**:
```bash
pnpm --filter @bookshelf/infra run deploy:env -- --env=dev --version=v1.2.3
```

## File Structure (After Refactoring)

```
packages/infra/
  bin/
    bookshelf.ts              # Main app (200 lines, down from 380)
    pipeline.ts               # Optional CDK Pipeline entry
  lib/
    auth-stack.ts
    api-stack.ts
    mcp-stack.ts
    web-stack.ts              # Now 70 lines (down from 280)
    hosting-construct.ts      # NEW: reusable CloudFront + S3
    environment-setup.ts      # NEW: reusable domain orchestration
    pipeline-stack.ts         # NEW: optional CDK Pipeline
    dns-stack.ts
    cdn-cert-stack.ts
    assets-stack.ts
  scripts/
    deploy-env.js             # NEW: deployment orchestrator
```

## Deployment Flow

### GitHub Actions (Recommended)

```
main branch push
  ↓
  GitHub Actions: deploy.yml
    ├─ Checkout + build + lint + test
    ├─ cdk synth (type-check)
    └─ Orchestrated deploy to dev
         ├─ Run deploy-env.js --env=dev
         ├─ Capture CloudFront domain
         ├─ Smoke tests
         ├─ Git tag v{version}
         └─ Trigger promote.yml
           ↓
           promote.yml (manual or triggered)
             ├─ Bootstrap Route53 (if needed)
             └─ Orchestrated deploy to prod
                  ├─ Run deploy-env.js --env=prod
                  ├─ Smoke tests
                  └─ GitHub Release
```

### CDK Pipelines (Alternative)

```
GitHub webhook (main branch push)
  ↓
  AWS CodePipeline: BookshelfPipeline
    ├─ Source: GitHub main
    ├─ Build: pnpm build + cdk synth
    └─ Dev Stage (manual approval)
         ├─ Deploy AuthStack + ApiStack + McpStack + WebStack
         └─ Approval gate
           ↓
           Prod Stage (manual approval)
             ├─ Deploy to prod
             └─ Approval gate
```

## Testing

- **Unit tests** (`packages/infra/test`) — 33 tests, all passing
  - Validates stack synthesis
  - Checks construct patterns
  - No fixture rebuilds needed
- **Integration tests** — via `cdk synth` (TypeScript compilation ensures type safety)
- **Smoke tests** — in CI after deploy (verify stack outputs, health checks)

## Benefits of Refactoring

1. **Reduced duplication**
   - WebStack: 280 → 70 lines
   - bin/bookshelf.ts: 380 → 200 lines
   - GitHub Actions workflows: 6 duplicate deploy steps → 1 orchestrator call

2. **Reusability**
   - WebHosting construct can be used by other stacks
   - setupCustomDomain() can be called from pipeline code
   - deploy-env.js works with any CDK app

3. **Testability**
   - WebHosting is unit-testable in isolation
   - setupCustomDomain() has no side effects (pure function)
   - deploy-env.js errors are caught early in CI

4. **Maintainability**
   - Changes to deployment logic happen in one place (deploy-env.js)
   - CloudFront/S3 logic lives in one file (hosting-construct.ts)
   - Domain setup orchestration is centralized (environment-setup.ts)

5. **Flexibility**
   - GitHub Actions and CDK Pipelines can both use the same deploy-env.js
   - WebHosting is optional (tests use default bucket if none provided)
   - Custom domain setup is optional (dev doesn't use it)

## Future Improvements

1. **CDK Pipeline enhancement**: Add post-deploy Lambda to inject CloudFront domain context, allowing automatic Auth re-deployment without manual approval
2. **Construct library**: Package WebHosting as a reusable library for other CDK apps
3. **Deployment gates**: Add smoke test results as manual approval context in CDK Pipeline
4. **Cost reporting**: Add Cost Explorer queries to deployment script to show cost delta

## Related Documentation

- `docs/runbooks/cicd-setup.md` — GitHub Actions setup (main path)
- `docs/runbooks/cdk-pipeline-setup.md` — CDK Pipeline setup (alternative)
- `docs/runbooks/pr-workflow.md` — Pre-merge checklist and deployment process
- `docs/adrs/` — Architecture Decision Records for DNS, deployment, versioning
