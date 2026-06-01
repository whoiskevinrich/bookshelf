/**
 * Integration tests for dynamo.ts — run against DynamoDB Local.
 *
 * Prerequisites:
 *   docker compose up -d dynamodb-local
 *   pnpm --filter @bookshelf/api test:integration
 */

import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  DynamoDBClient,
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
  ResourceNotFoundException,
} from "@aws-sdk/client-dynamodb";
import {
  queryShelf,
  putShelfEntry,
  getShelfEntry,
  deleteShelfEntry,
  updateShelfStatus,
  putBookMetadata,
  encodeCursor,
  decodeCursor,
} from "../../src/lib/dynamo.js";

const ENDPOINT = process.env["DYNAMODB_ENDPOINT"] ?? "http://127.0.0.1:8000";
const TABLE = process.env["DYNAMODB_TABLE_NAME"] ?? "bookshelf-integration-test";

const rawClient = new DynamoDBClient({
  endpoint: ENDPOINT,
  region: "us-east-1",
  credentials: {
    accessKeyId: "DUMMYACCESSKEYID0001",
    secretAccessKey: "dummysecretaccesskey0001",
  },
});

async function waitUntilActive(maxMs = 1000): Promise<void> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const { Table } = await rawClient.send(new DescribeTableCommand({ TableName: TABLE }));
    if (Table?.TableStatus === "ACTIVE") return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`Table did not become ACTIVE within ${maxMs}ms`);
}

beforeAll(async () => {
  // Drop any leftover table from a previous interrupted run so tests start fresh.
  // DynamoDB Local deletes synchronously — no polling needed after delete.
  try {
    await rawClient.send(new DeleteTableCommand({ TableName: TABLE }));
  } catch (err) {
    if (!(err instanceof ResourceNotFoundException)) throw err;
  }

  await rawClient.send(
    new CreateTableCommand({
      TableName: TABLE,
      BillingMode: "PAY_PER_REQUEST",
      KeySchema: [
        { AttributeName: "PK", KeyType: "HASH" },
        { AttributeName: "SK", KeyType: "RANGE" },
      ],
      AttributeDefinitions: [
        { AttributeName: "PK", AttributeType: "S" },
        { AttributeName: "SK", AttributeType: "S" },
      ],
    }),
  );
  await waitUntilActive();
});

afterAll(async () => {
  try {
    await rawClient.send(new DeleteTableCommand({ TableName: TABLE }));
  } catch {
    // best-effort cleanup
  }
});

// Each test uses a random userId so tests are order-independent and don't share state.
function nextUser(): string {
  return `u-${randomUUID()}`;
}

const ISBN_DUNE = "9780441013593";
const ISBN_NEURO = "9780441569595";
const BOOK_META = {
  title: "Dune",
  authors: ["Frank Herbert"],
  coverUrl: "https://covers.openlibrary.org/b/isbn/9780441013593-M.jpg",
  publishedYear: 1965,
  description: "A sweeping tale set on Arrakis.",
};

// ── putShelfEntry ──────────────────────────────────────────────────────────

describe("putShelfEntry", () => {
  it("adds a shelf entry without error", async () => {
    const userId = nextUser();
    await expect(
      putShelfEntry(userId, ISBN_DUNE, "owned", new Date().toISOString()),
    ).resolves.toBeUndefined();
  });

  it("throws ConditionalCheckFailedException on duplicate", async () => {
    const userId = nextUser();
    const addedAt = new Date().toISOString();
    await putShelfEntry(userId, ISBN_DUNE, "owned", addedAt);
    await expect(putShelfEntry(userId, ISBN_DUNE, "owned", addedAt)).rejects.toThrow();
  });
});

// ── getShelfEntry ──────────────────────────────────────────────────────────

describe("getShelfEntry", () => {
  it("returns the entry after put", async () => {
    const userId = nextUser();
    const addedAt = new Date().toISOString();
    await putShelfEntry(userId, ISBN_DUNE, "owned", addedAt);

    const entry = await getShelfEntry(userId, ISBN_DUNE);
    expect(entry).not.toBeNull();
    expect(entry?.isbn).toBe(ISBN_DUNE);
    expect(entry?.status).toBe("owned");
    expect(entry?.addedAt).toBe(addedAt);
  });

  it("returns null when not on shelf", async () => {
    const userId = nextUser();
    const entry = await getShelfEntry(userId, ISBN_DUNE);
    expect(entry).toBeNull();
  });

  it("finds an entry regardless of status (owned or want)", async () => {
    const userId = nextUser();
    await putShelfEntry(userId, ISBN_DUNE, "want", new Date().toISOString());
    const entry = await getShelfEntry(userId, ISBN_DUNE);
    expect(entry?.status).toBe("want");
  });
});

// ── deleteShelfEntry ───────────────────────────────────────────────────────

describe("deleteShelfEntry", () => {
  it("removes an entry so getShelfEntry returns null", async () => {
    const userId = nextUser();
    await putShelfEntry(userId, ISBN_DUNE, "owned", new Date().toISOString());
    await deleteShelfEntry(userId, ISBN_DUNE, "owned");
    const entry = await getShelfEntry(userId, ISBN_DUNE);
    expect(entry).toBeNull();
  });

  it("is idempotent — deleting a non-existent entry does not throw", async () => {
    const userId = nextUser();
    await expect(deleteShelfEntry(userId, ISBN_DUNE, "owned")).resolves.toBeUndefined();
  });
});

// ── updateShelfStatus ──────────────────────────────────────────────────────

describe("updateShelfStatus", () => {
  it("moves a book from owned to want", async () => {
    const userId = nextUser();
    const addedAt = new Date().toISOString();
    await putShelfEntry(userId, ISBN_DUNE, "owned", addedAt);

    await updateShelfStatus(userId, ISBN_DUNE, "owned", "want", addedAt);

    const entry = await getShelfEntry(userId, ISBN_DUNE);
    expect(entry?.status).toBe("want");
  });

  it("moves a book from want to owned", async () => {
    const userId = nextUser();
    const addedAt = new Date().toISOString();
    await putShelfEntry(userId, ISBN_DUNE, "want", addedAt);

    await updateShelfStatus(userId, ISBN_DUNE, "want", "owned", addedAt);

    const entry = await getShelfEntry(userId, ISBN_DUNE);
    expect(entry?.status).toBe("owned");
  });

  it("preserves addedAt timestamp after move", async () => {
    const userId = nextUser();
    const addedAt = "2026-01-15T12:00:00.000Z";
    await putShelfEntry(userId, ISBN_DUNE, "owned", addedAt);

    await updateShelfStatus(userId, ISBN_DUNE, "owned", "want", addedAt);

    const entry = await getShelfEntry(userId, ISBN_DUNE);
    expect(entry?.addedAt).toBe(addedAt);
  });
});

// ── putBookMetadata ────────────────────────────────────────────────────────

describe("putBookMetadata", () => {
  it("stores book metadata retrievable via queryShelf", async () => {
    const userId = nextUser();
    const addedAt = new Date().toISOString();

    await putBookMetadata(ISBN_DUNE, BOOK_META, addedAt);
    await putShelfEntry(userId, ISBN_DUNE, "owned", addedAt);

    const result = await queryShelf({ userId });
    const entry = result.entries[0];
    expect(entry?.book?.title).toBe("Dune");
    expect(entry?.book?.authors).toEqual(["Frank Herbert"]);
    expect(entry?.book?.publishedYear).toBe(1965);
  });
});

// ── queryShelf ─────────────────────────────────────────────────────────────

describe("queryShelf", () => {
  it("returns empty result for a new user", async () => {
    const userId = nextUser();
    const result = await queryShelf({ userId });
    expect(result.entries).toHaveLength(0);
    expect(result.total).toBe(0);
    expect(result.nextCursor).toBeNull();
  });

  it("returns all entries for a user", async () => {
    const userId = nextUser();
    const addedAt = new Date().toISOString();
    await putShelfEntry(userId, ISBN_DUNE, "owned", addedAt);
    await putShelfEntry(userId, ISBN_NEURO, "want", addedAt);

    const result = await queryShelf({ userId });
    expect(result.total).toBe(2);
    expect(result.entries).toHaveLength(2);
  });

  // Both filter tests share one user seeded once — halves the DynamoDB writes.
  describe("status filter", () => {
    let sharedUserId: string;
    beforeAll(async () => {
      sharedUserId = nextUser();
      const addedAt = new Date().toISOString();
      await putShelfEntry(sharedUserId, ISBN_DUNE, "owned", addedAt);
      await putShelfEntry(sharedUserId, ISBN_NEURO, "want", addedAt);
    });

    it("filters by status=owned", async () => {
      const result = await queryShelf({ userId: sharedUserId, status: "owned" });
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]?.isbn).toBe(ISBN_DUNE);
    });

    it("filters by status=want", async () => {
      const result = await queryShelf({ userId: sharedUserId, status: "want" });
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]?.isbn).toBe(ISBN_NEURO);
    });
  });

  it("paginates with limit and returns a cursor", async () => {
    const userId = nextUser();
    const addedAt = new Date().toISOString();
    await putShelfEntry(userId, ISBN_DUNE, "owned", addedAt);
    await putShelfEntry(userId, ISBN_NEURO, "owned", addedAt);

    const page1 = await queryShelf({ userId, limit: 1 });
    expect(page1.entries).toHaveLength(1);
    expect(page1.nextCursor).not.toBeNull();
    expect(page1.total).toBe(2);

    const page2 = await queryShelf({ userId, limit: 1, cursor: page1.nextCursor! });
    expect(page2.entries).toHaveLength(1);
    // DynamoDB may return a cursor even on the last page when Limit equals remaining items;
    // verify all items are accounted for instead of asserting cursor is null.
    expect(page2.total).toBe(2);

    const allIsbns = [page1.entries[0]!.isbn, page2.entries[0]!.isbn];
    expect(allIsbns).toContain(ISBN_DUNE);
    expect(allIsbns).toContain(ISBN_NEURO);
  });

  it("returns book=null when metadata is missing", async () => {
    const userId = nextUser();
    const unknownIsbn = "9780000000001";
    await putShelfEntry(userId, unknownIsbn, "owned", new Date().toISOString());

    const result = await queryShelf({ userId });
    expect(result.entries[0]?.book).toBeNull();
  });

  it("does not return entries from another user", async () => {
    const userA = nextUser();
    const userB = nextUser();
    const addedAt = new Date().toISOString();
    await putShelfEntry(userA, ISBN_DUNE, "owned", addedAt);

    const result = await queryShelf({ userId: userB });
    expect(result.entries).toHaveLength(0);
  });
});

// ── cursor helpers ─────────────────────────────────────────────────────────

describe("encodeCursor / decodeCursor", () => {
  it("roundtrips a DynamoDB exclusive start key", () => {
    const key = { PK: "USER#abc", SK: "SHELF#owned#9780441013593" };
    expect(decodeCursor(encodeCursor(key))).toEqual(key);
  });
});
