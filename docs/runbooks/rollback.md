# Runbook: Rollback Procedures

How to roll back each layer of the Bookshelf stack after a bad deploy.

---

## Overview

The stack has three independently deployable CDK stacks. Each can be rolled back separately depending on where the problem is.

| Stack | What it owns | Rollback method |
|---|---|---|
| `AuthStack` | Cognito User Pool + App Client + SSM params | CDK redeploy from prior tag |
| `ApiStack` | DynamoDB table + Lambda + API Gateway + SSM params | CDK redeploy from prior tag |
| `WebStack` | S3 + CloudFront + OAC + SSM params | CDK redeploy from prior tag OR S3 prefix swap |

The **fastest rollback path** for any layer is the `promote.yml` workflow — check out a prior version tag and deploy it. Use the layer-specific procedures below only when a targeted fix is faster than a full redeploy.

---

## 1. Full Stack Rollback via promote.yml (preferred)

Use this when a merge to `main` caused a regression and you want to restore a known-good version across all stacks.

1. Find the last good version tag:
   ```bash
   git tag --sort=-version:refname | head -10
   ```

2. Trigger the **Promote to Production** workflow from GitHub Actions UI:
   - Go to **Actions → Promote to Production → Run workflow**
   - Enter the version (e.g. `0.1.3`)

3. The workflow will:
   - Check out the code at `v0.1.3`
   - Validate the version matches `package.json`
   - Run `cdk deploy --all` against prod

For dev/sandbox rollback, check out the tag locally and run:
```bash
git checkout v0.1.3
pnpm deploy:infra
```

---

## 2. Lambda Rollback (API layer only)

Lambda keeps the previous version available. If only the Lambda function regressed:

### Option A — CDK redeploy from prior tag (clean)
```bash
git checkout v<prior-version>
pnpm --filter @bookshelf/infra run deploy
```

### Option B — AWS CLI alias swap (faster, temporary)
```bash
# Find the previous published version number
aws lambda list-versions-by-function \
  --function-name bookshelf-api \
  --query 'Versions[-2].Version' \
  --output text

# Point the LIVE alias back to it
aws lambda update-alias \
  --function-name bookshelf-api \
  --name LIVE \
  --function-version <previous-version-number>
```

> **Note**: Option B is a hotfix — it diverges from CDK state. Follow up with a CDK redeploy to reconcile.

---

## 3. Web Frontend Rollback (S3 + CloudFront)

The `WebStack` deploys assets under a versioned S3 key prefix (`/v{version}/`). Prior versions remain in S3 unless explicitly deleted.

### Swap the CloudFront origin path back to a prior version

1. Find the prior version prefix in S3:
   ```bash
   aws s3 ls s3://bookshelf-web-<account-id>/ --recursive | grep "index.html"
   ```

2. Update the CloudFront distribution's origin path:
   ```bash
   # Get the distribution ID from SSM
   DIST_ID=$(aws ssm get-parameter \
     --name /bookshelf/web/distribution-id \
     --query Parameter.Value --output text)

   # Get current config + ETag
   aws cloudfront get-distribution-config --id "$DIST_ID" > dist-config.json
   ETAG=$(jq -r .ETag dist-config.json)

   # Edit OriginPath in dist-config.json to /v0.1.3 (prior version), then:
   aws cloudfront update-distribution \
     --id "$DIST_ID" \
     --if-match "$ETAG" \
     --distribution-config file://dist-config.json
   ```

3. Invalidate the CloudFront cache:
   ```bash
   aws cloudfront create-invalidation \
     --distribution-id "$DIST_ID" \
     --paths "/*"
   ```

> **Simpler alternative**: run a CDK redeploy from the prior tag — the `WebStack` will reset the origin path and invalidate automatically.

---

## 4. DynamoDB

DynamoDB does not support point-in-time rollback of individual items via CDK redeploy. The table schema is append-only — CDK will not drop or recreate the table on redeploy (DynamoDB tables are retained by default).

For data corruption:
- **Point-in-time recovery (PITR)**: enabled on the table — restore via AWS Console or CLI to any second in the past 35 days.
- **Per-item recovery**: not supported without PITR restore to a new table + manual diff.

```bash
# Restore table to a point in time (creates a NEW table)
aws dynamodb restore-table-to-point-in-time \
  --source-table-name bookshelf \
  --target-table-name bookshelf-restored-20260530 \
  --restore-date-time 2026-05-30T10:00:00Z
```

---

## 5. Auth (Cognito)

Cognito User Pools **cannot be rolled back** — user accounts and confirmed emails are permanent. CDK will never delete a User Pool on redeploy (removal policy is `RETAIN`).

If an App Client configuration change caused a regression (e.g. wrong OAuth scopes), fix forward by updating the CDK stack and redeploying. Do not attempt to recreate the User Pool.

---

## SSM Parameter Verification

After any rollback, confirm SSM params match the deployed stack:

```bash
aws ssm get-parameters-by-path \
  --path /bookshelf/ \
  --recursive \
  --query 'Parameters[*].{Name:Name,Value:Value}' \
  --output table
```

---

## Decision Tree

```
Production incident
       │
       ▼
Is it a frontend-only issue? ──yes──▶ CloudFront origin path swap → cache invalidate
       │ no
       ▼
Is it an API/Lambda issue? ──yes──▶ Lambda alias swap (hotfix) or CDK redeploy
       │ no
       ▼
Is it an infra/config issue? ──yes──▶ promote.yml with prior version tag
       │ no
       ▼
Is it data corruption? ──yes──▶ DynamoDB PITR restore to new table
```
