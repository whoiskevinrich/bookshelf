# Runbook: CI/CD Setup

Initial configuration required before the GitHub Actions pipelines will work.

## Prerequisites

- AWS CLI configured with admin access to both `dev` and `prod` accounts
- GitHub CLI (`gh`) authenticated to the repo
- Two separate AWS accounts already bootstrapped with CDK (`cdk bootstrap`)

---

## 1. OIDC Identity Provider (one-time per account)

Both accounts should already have a GitHub OIDC provider configured. Verify with:

```bash
aws iam list-open-id-connect-providers --query 'OpenIDConnectProviderList[*].Arn'
```

Expected: an entry for `token.actions.githubusercontent.com`. If missing, create it:

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```

---

## 2. IAM Roles

Create one role in each account that GitHub Actions can assume.

### Trust Policy

Save as `trust-policy.json`, replacing `YOUR_GITHUB_ORG` and `YOUR_REPO_NAME`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:YOUR_GITHUB_ORG/YOUR_REPO_NAME:*"
        },
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        }
      }
    }
  ]
}
```

### Dev Account Role

```bash
aws iam create-role \
  --role-name bookshelf-github-actions-dev \
  --assume-role-policy-document file://trust-policy.json

# CDK deploy requires broad permissions; scope down after initial setup
aws iam attach-role-policy \
  --role-name bookshelf-github-actions-dev \
  --policy-arn arn:aws:iam::aws:policy/AdministratorAccess
```

> **Note**: `AdministratorAccess` is broad. Once the stacks are stable, replace with a scoped policy covering only the services the CDK stacks touch (Cognito, DynamoDB, Lambda, API Gateway, S3, CloudFront, SSM, IAM roles for Lambda execution).

### Prod Account Role

Repeat the above in the `prod` account:

```bash
aws iam create-role \
  --role-name bookshelf-github-actions-prod \
  --assume-role-policy-document file://trust-policy.json

aws iam attach-role-policy \
  --role-name bookshelf-github-actions-prod \
  --policy-arn arn:aws:iam::aws:policy/AdministratorAccess
```

Note the ARN of each role (`arn:aws:iam::ACCOUNT_ID:role/bookshelf-github-actions-dev`).

---

## 3. GitHub Actions Variables

Set at the repository level (not secrets — these are not sensitive):

Variables are **environment-scoped** — set them per environment so the same name (`AWS_ROLE_ARN`) resolves to the correct role automatically.

```bash
REPO="whoiskevinrich/bookshelf"

# Dev environment
gh variable set AWS_REGION    --body "us-west-2"                                              --repo "$REPO" -e dev
gh variable set AWS_ROLE_ARN  --body "arn:aws:iam::DEV_ACCOUNT_ID:role/bookshelf-github-actions-dev"   --repo "$REPO" -e dev
gh variable set AWS_ACCOUNT   --body "DEV_ACCOUNT_ID"                                         --repo "$REPO" -e dev

# Prod environment (add when prod account is ready)
gh variable set AWS_REGION    --body "us-west-2"                                              --repo "$REPO" -e prod
gh variable set AWS_ROLE_ARN  --body "arn:aws:iam::PROD_ACCOUNT_ID:role/bookshelf-github-actions-prod" --repo "$REPO" -e prod
gh variable set AWS_ACCOUNT   --body "PROD_ACCOUNT_ID"                                        --repo "$REPO" -e prod
```

Verify:

```bash
gh variable list --repo "$REPO" -e dev
gh variable list --repo "$REPO" -e prod
```

---

## 4. Optional: Personal Access Token for Version Bump PRs

The `version-bump.yml` workflow opens a PR from a bot branch. By default it uses `GITHUB_TOKEN`, but PRs opened with `GITHUB_TOKEN` do not trigger CI checks (GitHub limitation). To get CI checks on version bump PRs:

1. Create a fine-grained PAT with **Contents: Read & Write** and **Pull requests: Read & Write** scopes for this repo.
2. Store it as a repository secret named `GH_PAT`:

```bash
gh secret set GH_PAT --repo "$REPO"
```

If `GH_PAT` is not set, the workflow falls back to `GITHUB_TOKEN` and version bump PRs will not show CI checks automatically.

---

## 5. GitHub Environments

The deploy and promote workflows reference GitHub Environments (`dev` and `prod`) for audit trail and optional protection rules.

```bash
# Create environments via GitHub UI: Settings → Environments → New environment
# Name them exactly: dev, prod
```

Recommended protection rules for `prod`:

- **Required reviewers**: add at least yourself
- **Deployment branches**: `main` only

---

## 6. Branch Protection (main)

Configure via **Settings → Branches → Add branch ruleset** for `main`:

- ✅ Require status checks to pass before merging
  - Add: `Lint`, `Format`, `Unit Tests`, `CDK Synth`, `QA Guards`
    (no `Unique Version` check — the version is CI-derived at deploy, see ADR-017)
- ✅ Require branches to be up to date before merging
- ✅ Restrict deletions
- ✅ Block force pushes

---

## 7. Verify the Setup

1. Open a test PR — all five CI jobs should appear and pass.
2. Merge the PR — the `deploy.yml` workflow should trigger, deploy to dev, and push a `v{version}` tag.
3. Confirm the tag in GitHub: `gh release list` or `git tag -l`.
4. Run the `promote.yml` workflow with that version — it should deploy to prod.

---

## Deployment Orchestration

The `packages/infra/scripts/deploy-env.js` script orchestrates the multi-step build + deploy sequence,
eliminating duplication between `deploy.yml` and `promote.yml` workflows.

### What It Does

1. **Builds API bundle** — `esbuild` for Lambda
2. **Builds MCP bundle** — `esbuild` for Lambda
3. **Ensures web/dist exists** — Vite already built by `pnpm run build` in CI
4. **Deploys Auth + API + MCP stacks** — `cdk deploy` (skips WebStack)
5. **Builds web app** — Vite production build with runtime config from deployed stacks
6. **Deploys WebStack** — CloudFront + S3 with versioned assets
7. **Queries CloudFront domain** — if custom domain not set, inject domainless CF domain into context for Auth re-deploy
8. **Re-deploys Auth** — with CloudFront domain registered as Cognito OAuth callback URL

### Usage in CI

```bash
node packages/infra/scripts/deploy-env.js --env=dev --version=v1.2.3
node packages/infra/scripts/deploy-env.js --env=prod --version=v1.2.3
```

Or via npm script:

```bash
pnpm --filter @bookshelf/infra run deploy:env -- --env=dev --version=v1.2.3
```

### Alternative: CDK Pipelines

For AWS-native deployment management, see `docs/runbooks/cdk-pipeline-setup.md`.

## Decision: Primary Pipeline

- **Primary**: GitHub Actions (retain `deploy.yml` + `promote.yml`).
- **Why**: the repository already has a working, auditable, and GitHub-native release flow that centralises build/test/deploy logic via `packages/infra/scripts/deploy-env.js`. It minimizes new AWS infrastructure and keeps PRs, reviews, and deployment history inside GitHub.
- **CDK Pipeline**: supported as an optional alternative (see `cdk-pipeline-setup.md`) but should be treated as a migration target — do not run both concurrently. If you enable the CDK Pipeline, disable or remove the GitHub deploy workflows to avoid conflicting deploys and context injection issues.

---

## Troubleshooting

| Symptom                                                          | Likely cause                                                                         |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `Error: Not authorized to perform sts:AssumeRoleWithWebIdentity` | Trust policy `sub` condition doesn't match the repo path; double-check org/repo name |
| Version gate fails on a fresh branch                             | Tags were not fetched — `ci.yml` uses `fetch-tags: true`; verify the checkout step   |
| Version bump PR has no CI checks                                 | `GH_PAT` secret is not set; CI won't run on `GITHUB_TOKEN`-opened PRs                |
| `cdk deploy` fails with permissions error                        | IAM role policy is too restrictive; check CloudTrail for the denied action           |
