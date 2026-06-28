/**
 * One-time migration (ADR-019): converts shelf entries from the mutually-exclusive
 * `status` enum to the independent `owned` / `want` / `readingStatus` attributes.
 *
 * For every ENTRY#<isbn> item (PK USER#<userId>) that still lacks an `owned`
 * attribute, it sets:
 *
 *   owned         = (status === "owned")
 *   want          = (status === "want")
 *   readingStatus = null   (only if not already present)
 *
 * The legacy `status` attribute is INTENTIONALLY LEFT IN PLACE: the API emits a
 * derived `status` for one transition release (ADR-019 Q4), and the `toShelfEntry`
 * dual-read prefers `owned`/`want` once present, so keeping `status` is harmless.
 * It is dropped later in the cleanup task (ADR-019 action item 8) alongside the
 * dual-read fallback.
 *
 * Idempotent and safe to re-run: a ConditionExpression skips any item that already
 * has `owned`, so a second pass finds nothing to do.
 *
 * Run order: deploy the API change FIRST (so new writes use the attribute shape),
 * then run this backfill. Running it before the deploy is also safe — it only adds
 * fields the new code reads and the old code ignores.
 *
 * Usage (test against dev before prod):
 *   # with active AWS creds for the target account in the shell env:
 *   DYNAMODB_TABLE_NAME=bookshelf pnpm --filter @bookshelf/api migrate:attributes -- --dry-run
 *   DYNAMODB_TABLE_NAME=bookshelf pnpm --filter @bookshelf/api migrate:attributes
 *
 * Requires AWS credentials with DynamoDB read/write access to the table.
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  UpdateCommand,
  type NativeAttributeValue,
} from "@aws-sdk/lib-dynamodb";

const TABLE_NAME = process.env["DYNAMODB_TABLE_NAME"] ?? "bookshelf";
const DRY_RUN = process.argv.includes("--dry-run");

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

type Item = Record<string, NativeAttributeValue> & { PK: string; SK: string };

function isEntryItem(item: Item): boolean {
  return item.PK.startsWith("USER#") && item.SK.startsWith("ENTRY#");
}

async function* scanAll(): AsyncGenerator<Item> {
  let lastKey: Record<string, NativeAttributeValue> | undefined;
  do {
    const result = await client.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
      }),
    );
    for (const item of (result.Items ?? []) as Item[]) yield item;
    lastKey = result.LastEvaluatedKey as Record<string, NativeAttributeValue> | undefined;
  } while (lastKey);
}

async function migrate() {
  console.log(
    `[migrate-status-to-attributes] table=${TABLE_NAME} dry-run=${DRY_RUN ? "yes" : "no"}`,
  );

  let migrated = 0;
  let alreadyDone = 0;
  let skipped = 0;
  let malformed = 0;
  let errors = 0;

  for await (const item of scanAll()) {
    if (!isEntryItem(item)) {
      skipped++;
      continue;
    }
    if (item["owned"] !== undefined) {
      alreadyDone++;
      continue;
    }

    const status = item["status"];
    if (status !== "owned" && status !== "want") {
      // No usable status to derive from — leave it for manual review.
      console.warn(`  malformed (no owned/status): ${item.PK} | ${item.SK}`);
      malformed++;
      continue;
    }

    const owned = status === "owned";
    const want = status === "want";

    if (DRY_RUN) {
      console.log(`  [dry-run] ${item.PK} | ${item.SK} → owned=${owned} want=${want}`);
      migrated++;
      continue;
    }

    try {
      await client.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { PK: item.PK, SK: item.SK },
          UpdateExpression:
            "SET #owned = :owned, #want = :want, readingStatus = if_not_exists(readingStatus, :null)",
          ExpressionAttributeNames: { "#owned": "owned", "#want": "want" },
          ExpressionAttributeValues: { ":owned": owned, ":want": want, ":null": null },
          // Idempotent: only write if not already migrated.
          ConditionExpression: "attribute_not_exists(#owned)",
        }),
      );
      migrated++;
      if (migrated % 50 === 0) console.log(`  migrated ${migrated} items…`);
    } catch (err) {
      if ((err as { name?: string }).name === "ConditionalCheckFailedException") {
        // Raced with another run — already migrated.
        alreadyDone++;
      } else {
        console.error(`  ERROR migrating ${item.PK} / ${item.SK}:`, err);
        errors++;
      }
    }
  }

  console.log(
    `[migrate-status-to-attributes] done — migrated=${migrated} alreadyDone=${alreadyDone} ` +
      `malformed=${malformed} skipped=${skipped} errors=${errors}`,
  );
  if (errors > 0) process.exit(1);
}

migrate().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
