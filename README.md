# Bookshelf

A web app for tracking books you own and books you want to read — search by
title, ISBN, or ASIN, organize into owned/wishlist shelves, add reading
status, tags, and notes, scan barcodes from your phone, and build custom
smart shelves from saved filters.

**Live:** https://bookshelf.whoiskevinrich.com

## Why this exists

A solo hobby project with two goals: a book-tracking app I actually use, and
a testbed for agentic coding practices — the whole app, from spec to
deploy, is built working alongside Claude Code. See
[`docs/adrs/`](docs/adrs/) for the architecture decisions and
[`docs/specs/`](docs/specs/) for feature specs written before implementation.

## Tech stack

- **Frontend** — React SPA (Vite) + Tailwind CSS, hosted on S3 + CloudFront
- **API** — [Hono](https://hono.dev/) on Lambda behind API Gateway HTTP API
- **Data** — DynamoDB (single-table design, on-demand capacity)
- **Auth** — Amazon Cognito User Pools
- **MCP server** — a standalone MCP interface to the same API, for using
  Bookshelf from an AI assistant
- **Infrastructure** — AWS CDK (three stacks: Auth, API, Web)
- **CI/CD** — GitHub Actions; `cdk synth` on every PR, tagged deploy to `main`

Full rationale for each choice is in
[`docs/adrs/001-tech-stack.md`](docs/adrs/001-tech-stack.md).

## Monorepo layout

```
apps/
  api/    Hono API on Lambda
  mcp/    MCP server exposing the same functionality to AI clients
  web/    React SPA frontend
```

pnpm workspaces; see `package.json` at the root for the shared scripts
(`build`, `test`, `lint`, `preflight`, etc.).

## Local development

See [`docs/runbooks/local-dev.md`](docs/runbooks/local-dev.md) for the full
setup (AWS credentials, Cognito, DynamoDB). Short version:

```bash
pnpm install
pnpm dev
```
