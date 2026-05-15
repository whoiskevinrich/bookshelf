# ADR-001: Bookshelf — Tech Stack and Deployment

**Status:** Accepted  
**Date:** 2026-05-14  
**Deciders:** Solo developer

---

## Context

Hobby project focused on exploring and showcasing agentic coding practices. Multi-user web app for tracking books owned and wanted to read. Solo developer — minimize ops burden and cost.

**Driving constraints:**
- API and MCP server are the primary deliverables; web UI is a secondary consumer
- All infrastructure managed via AWS CDK
- CI/CD via GitHub Actions (with `cdk synth` on PRs, deploy on semver tags)
- Low cost is a hard constraint
- pnpm workspaces monorepo; separate packages as needed

---

## Decision Summary

| Area | Decision |
|------|----------|
| Frontend | React SPA (Vite) |
| Frontend hosting | S3 + CloudFront via CDK |
| Backend API | Hono on Lambda + API Gateway HTTP API |
| Database | DynamoDB (on-demand) |
| Auth | Amazon Cognito User Pools |
| Deployment | AWS CDK — three stacks: Auth, API, Web |
| CI/CD | GitHub Actions — `cdk synth` on PR; semver-tagged deploy to main |
| Versioning | Semantic versioning; S3 web builds stored by version string |
| Rollback | Web: SSM param + CloudFront invalidation (~1 min). API: redeploy previous tag (~3–5 min). |
| Book data | Google Books API; provider interface abstracts future sources |
| Package manager | pnpm workspaces |
| Styling | Tailwind CSS v4 + shadcn/ui |

---

## Options Considered

### Frontend Delivery

| Option | Hosting | SSR | MCP alignment | Complexity |
|--------|---------|-----|---------------|------------|
| **React SPA / Vite (chosen)** | S3 + CloudFront | No | Best — API fully standalone | Low |
| Next.js SSR | Lambda (Amplify or OpenNext) | Yes | OK — API tied to Next.js deploy | High |
| SvelteKit | Lambda adapter | Yes | OK | Medium |

**Choice: React SPA.** The app is entirely auth-gated so SEO is irrelevant, removing SSR's main benefit. A static SPA makes the API fully independent of the frontend deploy — the MCP server and the web UI are both just API consumers. S3 + CloudFront is simpler and cheaper than any server-rendered option.

---

### Database

| Option | Monthly cost (hobby) | Query model | Cold start | CDK-native |
|--------|---------------------|-------------|------------|------------|
| **DynamoDB on-demand (chosen)** | ~$0 | Key-value + GSI | None | Yes |
| Aurora Serverless v2 (auto-pause) | ~$2–5 | SQL / Postgres | 1–3 sec | Yes |
| Neon Postgres | ~$0 (free tier) | SQL / Postgres | ~500ms | No (external) |

**Choice: DynamoDB on-demand.** The bookshelf access patterns (list by user, filter by status, fetch by ISBN) map cleanly to a single-table design with SK prefixes. DynamoDB has a permanent free tier covering hobby scale with no auto-pause configuration required. Aurora Serverless v2 would cost ~$2–5/month even with auto-pause and requires explicit `serverlessV2MinCapacity: 0` in CDK to avoid a ~$43/month floor.

**DynamoDB single-table design (SK prefix strategy):**

| Entity | PK | SK |
|--------|----|----|
| Shelf entry (owned) | `USER#<cognitoSub>` | `SHELF#owned#<isbn13OrAsin>` |
| Shelf entry (want) | `USER#<cognitoSub>` | `SHELF#want#<isbn13OrAsin>` |
| Book metadata | `BOOK#<isbn13OrAsin>` | `METADATA` |

Queries:
- All shelf entries: `PK = USER#<id>`, `SK begins_with SHELF#`
- Owned only: `SK begins_with SHELF#owned#`
- Book metadata: `GetItem BOOK#<isbn>, METADATA`

---

### Auth

| Option | MAU free tier | CDK-native | MCP-compatible |
|--------|--------------|------------|----------------|
| **Amazon Cognito (chosen)** | 10,000/month (permanent) | Yes | Yes — JWKS endpoint |
| Auth.js | Unlimited (self-hosted) | No | Requires custom JWT setup |
| Clerk | 10,000/month | No | Yes |

**Choice: Cognito.** AWS-native, permanent free tier at 10k MAU, CDK-native. JWT verification via the public JWKS endpoint works identically for the Lambda API and the MCP server — no shared auth library, no cross-service coordination.

---

### Deployment

| Option | Next.js SSR support | CI/CD | CDK transparency | Hosting cost |
|--------|--------------------|----|------------------|-------------|
| **CDK direct — S3 + CF + Lambda (chosen)** | N/A (SPA) | GitHub Actions | Full | ~$0 |
| AWS Amplify Gen 2 | Automatic | GitHub connection | Low (abstracted) | ~$0 |
| App Runner (container) | Via Dockerfile | GitHub Actions | Full | ~$5–10/month |

**Choice: CDK directly (no Amplify).** Since the frontend is a static SPA, Amplify's main value (SSR Lambda management, per-branch previews) doesn't apply. Three CDK stacks cover everything: `AuthStack` (Cognito), `ApiStack` (DynamoDB + Lambda + API GW), `WebStack` (S3 + CloudFront). This gives full infrastructure transparency and is a better showcase of CDK usage.

---

### Book Provider

**Choice: Strategy pattern + env-var registry.**

A `BookProvider` interface in `apps/api/src/lib/books/types.ts` decouples all consumer code from any specific API. Adding Open Library or Hardcover = one new file + one registry entry + one env var (`BOOK_PROVIDER=open-library`). Google Books API is free at hobby scale (1,000 req/day).

---

## Cost Analysis

| Service | Free tier | Est. monthly (hobby) |
|---------|-----------|----------------------|
| DynamoDB | 25 GB + 25 RCU/WCU (permanent) | **$0** |
| Lambda | 1M req + 400k GB-sec/month | **$0** |
| API Gateway HTTP API | 1M calls/month (12 months) | **$0–1** |
| S3 + CloudFront | 5 GB / 50 GB bandwidth (12 months) | **$0** |
| Cognito | 10k MAU (permanent) | **$0** |
| CDK / CloudFormation | Free | **$0** |
| GitHub Actions | 2k–3k min/month | **$0** |
| **Total** | | **~$0/month** |

After 12-month free tier expires: ~$1–2/month.

---

## Consequences

**Easier:**
- API is a standalone service; MCP server and web UI are interchangeable consumers
- DynamoDB scales to zero without configuration
- Full infrastructure in CDK — reproducible, version-controlled, auditable
- Rollback is fast for the web layer (SSM + CloudFront invalidation, ~1 min)

**Harder:**
- DynamoDB single-table design requires upfront access pattern thinking; ad-hoc queries are less flexible than SQL
- API Lambda rollback requires a redeploy (~3–5 min) rather than an alias pointer swap
- No SSR means auth state and data fetching are client-side (acceptable since all pages are auth-gated)

**To revisit:**
- If SQL flexibility becomes important, Aurora Serverless v2 or Neon Postgres can replace DynamoDB with a data migration
- If the web app grows beyond a consumer and needs SSR, migrate `apps/web` to Next.js with the OpenNext CDK adapter — API layer doesn't change
