# Runbook: API Build and Deploy

How to build `apps/api` and deploy it to AWS Lambda.

---

## Prerequisites

- Node.js ≥ 20, pnpm ≥ 10
- AWS CLI authenticated with appropriate role
- `GOOGLE_BOOKS_API_KEY` available (optional — search works without a key at lower rate limits)

---

## 1. Install dependencies

```bash
pnpm install
```

---

## 2. Build the Lambda bundle

```bash
pnpm --filter @bookshelf/api run build
```

Output: `apps/api/dist/index.js` (bundled CJS, ~500 KB). AWS SDK packages are excluded — they are provided by the Lambda runtime.

The CDK `ApiStack` references this path via `lambda.Code.fromAsset("../../apps/api/dist")`. You must build before running `cdk deploy`.

---

## 3. Run unit tests

```bash
pnpm --filter @bookshelf/api run test
```

All 38 tests should pass before deploying.

---

## 4. Deploy via CDK

```bash
# Deploy API stack only
pnpm --filter @bookshelf/infra exec cdk deploy BookshelfApiStack --require-approval never

# Or deploy all stacks
pnpm --filter @bookshelf/infra exec cdk deploy --all --require-approval never
```

The CI/CD pipeline (`deploy.yml`) builds `apps/api` before synth automatically. Manual deploys must build first (step 2 above).

---

## 5. Smoke-test the deployed endpoints

Get the API URL from CDK outputs or SSM:

```bash
aws ssm get-parameter --name /bookshelf/api/url --query Parameter.Value --output text
```

```bash
API_URL=$(aws ssm get-parameter --name /bookshelf/api/url --query Parameter.Value --output text)

# Health check (no auth required)
curl "$API_URL/health"

# Book search (no auth required)
curl "$API_URL/v1/books/search?q=dune"

# Shelf endpoints require a Cognito JWT — get one via the Cognito hosted UI or aws cognito-idp
TOKEN="<bearer-token>"

curl -H "Authorization: Bearer $TOKEN" "$API_URL/v1/shelf"

curl -X POST "$API_URL/v1/shelf" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"isbn":"9780441013593","status":"owned"}'
```

---

## Environment Variables

Set in `ApiStack` at deploy time. Lambda reads these at runtime.

| Variable               | Required | Default        | Notes                                     |
| ---------------------- | -------- | -------------- | ----------------------------------------- |
| `DYNAMODB_TABLE_NAME`  | Yes      | `bookshelf`    | Set automatically by CDK                  |
| `COGNITO_USER_POOL_ID` | Yes      | —              | Set automatically by CDK from `AuthStack` |
| `COGNITO_CLIENT_ID`    | Yes      | —              | Set automatically by CDK from `AuthStack` |
| `COGNITO_ISSUER`       | Yes      | —              | Set automatically by CDK from `AuthStack` |
| `GOOGLE_BOOKS_API_KEY` | No       | `""` (no key)  | Inject from GitHub Actions secret         |
| `BOOK_PROVIDER`        | No       | `google-books` | Switch provider without code change       |

`GOOGLE_BOOKS_API_KEY` is not set by CDK — inject it at deploy time:

```bash
aws lambda update-function-configuration \
  --function-name bookshelf-api \
  --environment "Variables={GOOGLE_BOOKS_API_KEY=<key>}"
```

Or set `GOOGLE_BOOKS_API_KEY` as a GitHub Actions secret named `GOOGLE_BOOKS_API_KEY` — `deploy.yml` will inject it automatically.

---

## Troubleshooting

**`CannotFindAsset` during CDK synth**
Build `apps/api` first: `pnpm --filter @bookshelf/api run build`

**401 on shelf endpoints**
Token is expired or audience mismatch. Verify `COGNITO_CLIENT_ID` matches the app client used to issue the token.

**502 on `/v1/books/search`**
Google Books API is unreachable or the API key is invalid. Check CloudWatch logs: `/aws/lambda/bookshelf-api`.

**409 on `POST /v1/shelf`**
The ISBN is already on the user's shelf (either `owned` or `want`). Use `PATCH` to change status.
