# CDK Pipeline Setup (Optional)

## Overview

The Bookshelf CDK app can optionally use AWS CDK Pipelines to manage multi-stage deployments to dev and prod environments. This is an alternative (not in addition to) the GitHub Actions workflows.

> Repository decision: GitHub Actions is the primary, recommended pipeline. The CDK Pipeline remains available as an optional migration path for teams that prefer an AWS-native pipeline. If you enable the CDK Pipeline, disable the GitHub `deploy.yml` and `promote.yml` workflows to avoid conflicting deploys.

**When to use CDK Pipelines:**
- You prefer to manage deployment pipelines through AWS Console rather than GitHub
- You want integrated rollback and deployment history tracking in AWS
- You want automated pipeline self-updates (any changes to PipelineStack auto-deploy)
- You're using multiple AWS accounts and want tight CDK/CloudFormation coupling

**When to use GitHub Actions (recommended):**
- Your team is GitHub-first (PRs, reviews, audit in GitHub)
- You prefer CI/CD logs and history in GitHub Actions
- You want to control deployments from the repo itself
- You already have GitHub OIDC role configured

**⚠️ IMPORTANT: Do not run both simultaneously.** CDK Pipelines and GitHub Actions workflows both
deploy to the same stacks and will conflict when injecting CloudFront domain context. Choose one.

## Quick Start (CDK Pipelines)

### 1. Create a GitHub Personal Access Token

1. Go to https://github.com/settings/tokens
2. Click "Generate new token (classic)"
3. Set scope: `repo` + `admin:repo_hook`
4. Copy the token

### 2. Store Token in AWS Secrets Manager

```powershell
aws secretsmanager create-secret `
  --name github-token `
  --secret-string '{\"token\":\"ghp_xxxxxxxxxxxx\"}' `
  --region us-west-2
```

Or use the AWS Console: Secrets Manager → Create Secret → Store as JSON.

### 3. Deploy the Pipeline Stack

From the root directory:

```powershell
cd packages/infra
pnpm run build
cdk deploy BookshelfPipeline --context github-token=ghp_xxxxxxxxxxxx
```

Or use the env var:

```powershell
$env:CDK_GITHUB_TOKEN = "ghp_xxxxxxxxxxxx"
cdk deploy BookshelfPipeline
```

The pipeline is now live. Any push to `main` will trigger a dev deployment (with manual approval gate).
Release tags will trigger prod deployments (with separate approval gate).

### 4. View Pipeline Status

Open the AWS Console → CodePipeline → BookshelfPipeline, or click the `PipelineUrl` output from the cdk deploy.

## How It Works

### Pipeline Stages

1. **Source**: Watches `main` branch (and release tags) on GitHub
2. **Build**: Runs `pnpm build` + `cdk synth`
3. **Dev Deploy**: Deploys AuthStack, ApiStack, McpStack, WebStack (manual approval gate)
4. **Prod Deploy**: Same, but with additional confirmation + optional smoke test gating

### Self-Mutation

After the first deploy, the pipeline becomes self-mutating. Any changes to `lib/pipeline-stack.ts` or
`bin/pipeline.ts` automatically update the pipeline on the next commit to `main`.

### Runtime Context

Unlike GitHub Actions, CDK Pipelines doesn't currently inject CloudFront domain context after WebStack deploys.
A future enhancement could add a post-deploy Lambda to update the domain context for Auth re-deployment.

For now, the prod deployment assumes the custom domain is pre-configured in Route53/Cloudflare.

## Disabling GitHub Actions (if using CDK Pipelines)

To prevent conflicts, disable GitHub Actions workflows:

1. Go to Actions → All workflows
2. Disable `deploy.yml` and `promote.yml`
3. Or delete `.github/workflows/deploy.yml` and `promote.yml`

## Migration notes — moving from GitHub Actions to CDK Pipeline

- Ensure the pipeline token is provisioned and accessible (see step 1/2 above).
- Confirm `packages/infra/scripts/deploy-env.js` behavior: the pipeline build must run the same build steps (API, MCP, stub web/dist, synth) or call the same orchestrator so runtime context (CloudFront domain → Cognito) is handled consistently.
- Before enabling the CDK Pipeline, run a dry-run deployment from GitHub Actions and capture the hosted zone/context values in `packages/infra/cdk.context.json` so the pipeline synth stage does not fail on Route53 lookups.
- Plan a short maintenance window when switching to avoid concurrent deploys; disable GitHub deploy workflows in the repo settings first, then deploy the pipeline and validate a single full release (dev → prod) from CodePipeline.

## Troubleshooting

### "Permission Denied" on Pipeline Deployment

- Verify the GitHub token has `repo` + `admin:repo_hook` scopes
- Check the token is not expired
- Ensure the secret is in Secrets Manager under the correct region

### Pipeline Fails to Find Source

- Verify the repository path in `bin/pipeline.ts` matches your actual repo (`owner/repo`)
- Ensure the GitHub token has access to the repository
- Check that the repository is public or the token has private repo access

### CloudFront Domain Not Registered After Web Deploy

Currently, CDK Pipelines does not automatically inject the CloudFront domain context into Auth
for re-deployment (as GitHub Actions does). To use a custom domain:

1. Bootstrap Route53 and set DNS records manually (ADR-013)
2. Or, add a post-deploy Lambda to the pipeline that updates the context

## Reference

- CDK Pipelines docs: https://docs.aws.amazon.com/cdk/latest/guide/cdk_pipeline.html
- GitHub Actions guide: `docs/runbooks/cicd-setup.md`
- Pipeline code: `packages/infra/lib/pipeline-stack.ts` and `packages/infra/bin/pipeline.ts`
