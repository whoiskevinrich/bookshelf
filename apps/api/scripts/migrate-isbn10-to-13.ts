/**
 * One-time migration: canonicalizes any DynamoDB item keyed by an ISBN-10 to its
 * ISBN-13 form, matching the new `normalizeIsbn` write-boundary behavior. Rewrites
 * three item types:
 *
 *   - ENTRY#<isbn>                (PK USER#<userId>)  — shelf entries
 *   - SMEMBER#<shelfId>#<isbn>    (PK USER#<userId>)  — named-shelf memberships
 *   - BOOK#<isbn> / METADATA      (PK BOOK#<isbn>)     — shared metadata cache
 *
 * Run AFTER deploying the API change (so no new ISBN-10 keys are being written),
 * or before — either way it's idempotent and safe to re-run: a second pass finds
 * no ISBN-10 keys left to convert.
 *
 * Collisions: if the ISBN-13 target already exists (the same physical book was
 * added via both an ISBN-10 and an ISBN-13 path), the existing ISBN-13 item is
 * kept and the stale ISBN-10 item is deleted. Such cases are counted and logged
 * so they can be reviewed.
 *
 * Usage (test against dev before prod):
 *   # with active AWS creds for the target account in the shell env:
 *   DYNAMODB_TABLE_NAME=bookshelf pnpm --filter @bookshelf/api migrate:isbn13 -- --dry-run
 *   DYNAMODB_TABLE_NAME=bookshelf pnpm --filter @bookshelf/api migrate:isbn13
 *
 * Requires AWS credentials with DynamoDB read/write access to the table.
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  PutCommand,
  DeleteCommand,
  type NativeAttributeValue,
} from "@aws-sdk/lib-dynamodb";
import { isValidIsbn10, isbn10to13 } from "../src/lib/isbn.js";

const TABLE_NAME = process.env["DYNAMODB_TABLE_NAME"] ?? "bookshelf";
const DRY_RUN = process.argv.includes("--dry-run");

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

type Item = Record<string, NativeAttributeValue> & { PK: string; SK: string };

/**
 * If this item is keyed by an ISBN-10, returns the rewritten item (new PK/SK/isbn
 * in ISBN-13 form). Returns null for items that need no conversion.
 */
function planRewrite(item: Item): { newItem: Item } | null {
  const { PK, SK } = item;

  // Shared metadata cache: BOOK#<isbn> / METADATA
  if (PK.startsWith("BOOK#") && SK === "METADATA") {
    const isbn = PK.slice("BOOK#".length);
    if (!isValidIsbn10(isbn)) return null;
    const isbn13 = isbn10to13(isbn);
    return { newItem: { ...item, PK: `BOOK#${isbn13}`, isbn: isbn13 } };
  }

  if (PK.startsWith("USER#")) {
    // Shelf entry: ENTRY#<isbn>
    if (SK.startsWith("ENTRY#")) {
      const isbn = SK.slice("ENTRY#".length);
      if (!isValidIsbn10(isbn)) return null;
      const isbn13 = isbn10to13(isbn);
      return { newItem: { ...item, SK: `ENTRY#${isbn13}`, isbn: isbn13 } };
    }

    // Named-shelf membership: SMEMBER#<shelfId>#<isbn>
    if (SK.startsWith("SMEMBER#")) {
      const lastHash = SK.lastIndexOf("#");
      const isbn = SK.slice(lastHash + 1);
      if (!isValidIsbn10(isbn)) return null;
      const isbn13 = isbn10to13(isbn);
      const prefix = SK.slice(0, lastHash); // SMEMBER#<shelfId>
      return { newItem: { ...item, SK: `${prefix}#${isbn13}`, isbn: isbn13 } };
    }
  }

  return null;
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
  console.log(`[migrate-isbn10-to-13] table=${TABLE_NAME} dry-run=${DRY_RUN ? "yes" : "no"}`);

  let migrated = 0;
  let collisions = 0;
  let skipped = 0;
  let errors = 0;

  for await (const item of scanAll()) {
    const plan = planRewrite(item);
    if (!plan) {
      skipped++;
      continue;
    }
    const { newItem } = plan;

    if (DRY_RUN) {
      console.log(`  [dry-run] ${item.PK} | ${item.SK} → ${newItem.PK} | ${newItem.SK}`);
      migrated++;
      continue;
    }

    try {
      // Write the ISBN-13 item only if it doesn't already exist; on collision keep
      // the existing target. Either way, remove the stale ISBN-10 item afterward.
      let collided = false;
      try {
        await client.send(
          new PutCommand({
            TableName: TABLE_NAME,
            Item: newItem,
            ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
          }),
        );
      } catch (err) {
        if ((err as { name?: string }).name === "ConditionalCheckFailedException") {
          collided = true;
        } else {
          throw err;
        }
      }

      await client.send(
        new DeleteCommand({ TableName: TABLE_NAME, Key: { PK: item.PK, SK: item.SK } }),
      );

      if (collided) {
        collisions++;
        console.log(
          `  collision — kept existing ${newItem.PK} | ${newItem.SK}, deleted stale ${item.PK} | ${item.SK}`,
        );
      } else {
        migrated++;
        if (migrated % 50 === 0) console.log(`  migrated ${migrated} items…`);
      }
    } catch (err) {
      console.error(`  ERROR migrating ${item.PK} / ${item.SK}:`, err);
      errors++;
    }
  }

  console.log(
    `[migrate-isbn10-to-13] done — migrated=${migrated} collisions=${collisions} skipped=${skipped} errors=${errors}`,
  );
  if (errors > 0) process.exit(1);
}

migrate().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
