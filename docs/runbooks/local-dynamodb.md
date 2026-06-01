# Runbook: DynamoDB Local

Run DynamoDB locally via Docker for development — no AWS credentials needed.

## Prerequisites

- Docker Desktop running

## First-time setup

### 1. Add to `apps/api/.env.local`

```
DYNAMODB_ENDPOINT=http://localhost:8000
DYNAMODB_TABLE_NAME=bookshelf
LOCAL_DEV_USER_ID=<your-cognito-user-id>
```

**Finding your Cognito user ID:**
AWS Console → Cognito → User Pools → `bookshelf-users` → Users tab → click your user → copy the **User ID** (UUID format).

### 2. Start DynamoDB Local

```sh
docker compose up -d
```

Data is persisted to a Docker volume (`dynamodb-data`) and survives container restarts.

### 3. Create the table and seed demo data

```sh
pnpm --filter @bookshelf/api db:seed
```

This creates the `bookshelf` table (if it doesn't already exist) and seeds 10 Sci-Fi/Fantasy books (5 owned, 5 want) under your `LOCAL_DEV_USER_ID`.

Safe to re-run — existing items are overwritten, not duplicated.

### 4. Start the API

```sh
pnpm --filter @bookshelf/api dev
```

The dev server picks up `DYNAMODB_ENDPOINT` from `.env.local` and points all DynamoDB calls at the local container.

## Daily use

```sh
docker compose up -d          # start DynamoDB Local
pnpm --filter @bookshelf/api dev   # start API (reads from local DynamoDB)
```

## Reset to demo data

To wipe and re-seed:

```sh
docker compose down -v        # removes the volume (deletes all data)
docker compose up -d          # fresh container
pnpm --filter @bookshelf/api db:seed
```

## Switching back to real AWS DynamoDB

Comment out `DYNAMODB_ENDPOINT` in `apps/api/.env.local`. The API will use your AWS credentials and the real table.

## Inspecting data

```sh
# List tables
aws dynamodb list-tables --endpoint-url http://localhost:8000 --region us-east-1 \
  --no-sign-request

# Scan all items
aws dynamodb scan --table-name bookshelf --endpoint-url http://localhost:8000 \
  --region us-east-1 --no-sign-request
```
