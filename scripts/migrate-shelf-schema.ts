/**
 * One-time migration: converts SHELF#<status>#<isbn> items to ENTRY#<isbn> items.
 *
 * Run BEFORE deploying the new API. Safe to re-run — PutItem overwrites are idempotent.
 *
 * Usage:
 *   npx tsx scripts/migrate-shelf-schema.ts [--dry-run]
 *
 * Requires AWS credentials with DynamoDB read/write access to the table.
 * Set DYNAMODB_TABLE_NAME env var if not using the default "bookshelf" table.
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  PutCommand,
  DeleteCommand,
  type NativeAttributeValue,
} from "@aws-sdk/lib-dynamodb";

const TABLE_NAME = process.env["DYNAMODB_TABLE_NAME"] ?? "bookshelf";
const DRY_RUN = process.argv.includes("--dry-run");

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

interface OldShelfItem {
  PK: string;
  SK: string;
  isbn: string;
  status: string;
  addedAt: string;
  notes: string | null;
  [key: string]: NativeAttributeValue;
}

async function* scanOldShelfItems(): AsyncGenerator<OldShelfItem> {
  let lastKey: Record<string, NativeAttributeValue> | undefined;
  do {
    const result = await client.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: "begins_with(SK, :prefix)",
        ExpressionAttributeValues: { ":prefix": "SHELF#" },
        ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
      }),
    );

    for (const item of result.Items ?? []) {
      // Only migrate old-style SHELF#owned#isbn / SHELF#want#isbn items
      const sk = item["SK"] as string;
      if (sk.startsWith("SHELF#owned#") || sk.startsWith("SHELF#want#")) {
        yield item as OldShelfItem;
      }
    }

    lastKey = result.LastEvaluatedKey as Record<string, NativeAttributeValue> | undefined;
  } while (lastKey);
}

async function migrate() {
  console.log(`[migrate-shelf-schema] table=${TABLE_NAME} dry-run=${DRY_RUN ? "yes" : "no"}`);

  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  for await (const item of scanOldShelfItems()) {
    const { PK, SK, isbn, status, addedAt, notes } = item;
    const newSK = `ENTRY#${isbn}`;

    if (DRY_RUN) {
      console.log(`  [dry-run] ${PK} | ${SK} → ${newSK}`);
      skipped++;
      continue;
    }

    try {
      await client.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: { PK, SK: newSK, isbn, status, addedAt, notes: notes ?? null },
        }),
      );
      await client.send(
        new DeleteCommand({
          TableName: TABLE_NAME,
          Key: { PK, SK },
        }),
      );
      migrated++;
      if (migrated % 50 === 0) console.log(`  migrated ${migrated} items…`);
    } catch (err) {
      console.error(`  ERROR migrating ${PK} / ${SK}:`, err);
      errors++;
    }
  }

  console.log(
    `[migrate-shelf-schema] done — migrated=${migrated} skipped=${skipped} errors=${errors}`,
  );
  if (errors > 0) process.exit(1);
}

migrate().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
