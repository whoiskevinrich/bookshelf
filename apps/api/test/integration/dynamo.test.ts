/**
 * Integration tests for dynamo.ts — run against real AWS DynamoDB (dev table).
 *
 * Prerequisites:
 *   AWS credentials in environment (via ~/.aws or env vars)
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
  queryBookEntries,
  getBookEntry,
  putBookEntry,
  deleteBookEntry,
  updateBookEntryAttributes,
  putBookMetadata,
  encodeCursor,
  decodeCursor,
} from "../../src/lib/dynamo.js";

const TABLE = process.env["DYNAMODB_TABLE_NAME"] ?? "bookshelf-integration-test";

const rawClient = new DynamoDBClient({});

async function waitUntilActive(maxMs = 30000): Promise<void> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const { Table } = await rawClient.send(new DescribeTableCommand({ TableName: TABLE }));
    if (Table?.TableStatus === "ACTIVE") return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Table did not become ACTIVE within ${maxMs}ms`);
}

beforeAll(async () => {
  // Drop any leftover table from a previous interrupted run so tests start fresh.
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

// ── putBookEntry ───────────────────────────────────────────────────────────

describe("putBookEntry", () => {
  it("adds an entry without error", async () => {
    const userId = nextUser();
    await expect(
      putBookEntry(userId, ISBN_DUNE, { owned: true, want: false }, new Date().toISOString()),
    ).resolves.toBeUndefined();
  });

  it("throws ConditionalCheckFailedException on duplicate", async () => {
    const userId = nextUser();
    const addedAt = new Date().toISOString();
    await putBookEntry(userId, ISBN_DUNE, { owned: true, want: false }, addedAt);
    await expect(
      putBookEntry(userId, ISBN_DUNE, { owned: true, want: false }, addedAt),
    ).rejects.toThrow();
  });
});

// ── getBookEntry ───────────────────────────────────────────────────────────

describe("getBookEntry", () => {
  it("returns the entry after put", async () => {
    const userId = nextUser();
    const addedAt = new Date().toISOString();
    await putBookEntry(userId, ISBN_DUNE, { owned: true, want: false }, addedAt);

    const entry = await getBookEntry(userId, ISBN_DUNE);
    expect(entry).not.toBeNull();
    expect(entry?.isbn).toBe(ISBN_DUNE);
    expect(entry?.owned).toBe(true);
    expect(entry?.want).toBe(false);
    expect(entry?.addedAt).toBe(addedAt);
  });

  it("returns null when not on shelf", async () => {
    const userId = nextUser();
    const entry = await getBookEntry(userId, ISBN_DUNE);
    expect(entry).toBeNull();
  });

  it("finds an entry regardless of owned/want combination", async () => {
    const userId = nextUser();
    await putBookEntry(userId, ISBN_DUNE, { owned: false, want: true }, new Date().toISOString());
    const entry = await getBookEntry(userId, ISBN_DUNE);
    expect(entry?.owned).toBe(false);
    expect(entry?.want).toBe(true);
  });
});

// ── deleteBookEntry ────────────────────────────────────────────────────────

describe("deleteBookEntry", () => {
  it("removes an entry so getBookEntry returns null", async () => {
    const userId = nextUser();
    await putBookEntry(userId, ISBN_DUNE, { owned: true, want: false }, new Date().toISOString());
    await deleteBookEntry(userId, ISBN_DUNE);
    const entry = await getBookEntry(userId, ISBN_DUNE);
    expect(entry).toBeNull();
  });

  it("is idempotent — deleting a non-existent entry does not throw", async () => {
    const userId = nextUser();
    await expect(deleteBookEntry(userId, ISBN_DUNE)).resolves.toBeUndefined();
  });
});

// ── updateBookEntryAttributes ─────────────────────────────────────────────

describe("updateBookEntryAttributes", () => {
  it("moves a book from owned to want", async () => {
    const userId = nextUser();
    const addedAt = new Date().toISOString();
    await putBookEntry(userId, ISBN_DUNE, { owned: true, want: false }, addedAt);

    await updateBookEntryAttributes(userId, ISBN_DUNE, { owned: false, want: true });

    const entry = await getBookEntry(userId, ISBN_DUNE);
    expect(entry?.owned).toBe(false);
    expect(entry?.want).toBe(true);
  });

  it("moves a book from want to owned", async () => {
    const userId = nextUser();
    const addedAt = new Date().toISOString();
    await putBookEntry(userId, ISBN_DUNE, { owned: false, want: true }, addedAt);

    await updateBookEntryAttributes(userId, ISBN_DUNE, { owned: true, want: false });

    const entry = await getBookEntry(userId, ISBN_DUNE);
    expect(entry?.owned).toBe(true);
    expect(entry?.want).toBe(false);
  });

  it("preserves addedAt timestamp after update", async () => {
    const userId = nextUser();
    const addedAt = "2026-01-15T12:00:00.000Z";
    await putBookEntry(userId, ISBN_DUNE, { owned: true, want: false }, addedAt);

    await updateBookEntryAttributes(userId, ISBN_DUNE, { owned: false, want: true });

    const entry = await getBookEntry(userId, ISBN_DUNE);
    expect(entry?.addedAt).toBe(addedAt);
  });
});

// ── putBookMetadata ────────────────────────────────────────────────────────

describe("putBookMetadata", () => {
  it("stores book metadata retrievable via queryBookEntries", async () => {
    const userId = nextUser();
    const addedAt = new Date().toISOString();

    await putBookMetadata(ISBN_DUNE, BOOK_META, addedAt);
    await putBookEntry(userId, ISBN_DUNE, { owned: true, want: false }, addedAt);

    const result = await queryBookEntries({ userId });
    const entry = result.entries[0];
    expect(entry?.book?.title).toBe("Dune");
    expect(entry?.book?.authors).toEqual(["Frank Herbert"]);
    expect(entry?.book?.publishedYear).toBe(1965);
  });
});

// ── queryBookEntries ───────────────────────────────────────────────────────

describe("queryBookEntries", () => {
  it("returns empty result for a new user", async () => {
    const userId = nextUser();
    const result = await queryBookEntries({ userId });
    expect(result.entries).toHaveLength(0);
    expect(result.total).toBe(0);
    expect(result.nextCursor).toBeNull();
  });

  it("returns all entries for a user", async () => {
    const userId = nextUser();
    const addedAt = new Date().toISOString();
    await putBookEntry(userId, ISBN_DUNE, { owned: true, want: false }, addedAt);
    await putBookEntry(userId, ISBN_NEURO, { owned: false, want: true }, addedAt);

    const result = await queryBookEntries({ userId });
    expect(result.total).toBe(2);
    expect(result.entries).toHaveLength(2);
  });

  // Both filter tests share one user seeded once — halves the DynamoDB writes.
  describe("owned/want filter", () => {
    let sharedUserId: string;
    beforeAll(async () => {
      sharedUserId = nextUser();
      const addedAt = new Date().toISOString();
      await putBookEntry(sharedUserId, ISBN_DUNE, { owned: true, want: false }, addedAt);
      await putBookEntry(sharedUserId, ISBN_NEURO, { owned: false, want: true }, addedAt);
    });

    it("filters by owned=true", async () => {
      const result = await queryBookEntries({ userId: sharedUserId, filter: { owned: true } });
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]?.isbn).toBe(ISBN_DUNE);
    });

    it("filters by want=true", async () => {
      const result = await queryBookEntries({ userId: sharedUserId, filter: { want: true } });
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]?.isbn).toBe(ISBN_NEURO);
    });
  });

  it("paginates with limit and returns a cursor", async () => {
    const userId = nextUser();
    const addedAt = new Date().toISOString();
    await putBookEntry(userId, ISBN_DUNE, { owned: true, want: false }, addedAt);
    await putBookEntry(userId, ISBN_NEURO, { owned: true, want: false }, addedAt);

    const page1 = await queryBookEntries({ userId, limit: 1 });
    expect(page1.entries).toHaveLength(1);
    expect(page1.nextCursor).not.toBeNull();
    expect(page1.total).toBe(2);

    const page2 = await queryBookEntries({ userId, limit: 1, cursor: page1.nextCursor! });
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
    await putBookEntry(userId, unknownIsbn, { owned: true, want: false }, new Date().toISOString());

    const result = await queryBookEntries({ userId });
    expect(result.entries[0]?.book).toBeNull();
  });

  it("does not return entries from another user", async () => {
    const userA = nextUser();
    const userB = nextUser();
    const addedAt = new Date().toISOString();
    await putBookEntry(userA, ISBN_DUNE, { owned: true, want: false }, addedAt);

    const result = await queryBookEntries({ userId: userB });
    expect(result.entries).toHaveLength(0);
  });
});

// ── cursor helpers ─────────────────────────────────────────────────────────

describe("encodeCursor / decodeCursor", () => {
  it("roundtrips a DynamoDB exclusive start key", () => {
    const key = { PK: "USER#abc", SK: "ENTRY#9780441013593" };
    expect(decodeCursor(encodeCursor(key))).toEqual(key);
  });
});
