import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  GetCommand,
  PutCommand,
  DeleteCommand,
  UpdateCommand,
  BatchGetCommand,
  BatchWriteCommand,
  type NativeAttributeValue,
} from "@aws-sdk/lib-dynamodb";

// Lazy-initialized so that env vars loaded by dotenv in server.ts take effect
// before the client is constructed. ESM imports are hoisted, so top-level
// initialization runs before dotenv's config() call in server.ts.
let _dynamo: DynamoDBDocumentClient | undefined;

export function dynamo(): DynamoDBDocumentClient {
  if (!_dynamo) {
    _dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  }
  return _dynamo;
}

export const TABLE_NAME = process.env["DYNAMODB_TABLE_NAME"] ?? "bookshelf";

// ── Key helpers ────────────────────────────────────────────────────────────

export type ShelfStatus = "owned" | "want";

export function isValidStatus(s: unknown): s is ShelfStatus {
  return s === "owned" || s === "want";
}

function userPk(userId: string): string {
  return `USER#${userId}`;
}

function entrySk(isbn: string): string {
  return `ENTRY#${isbn}`;
}

function shelfMetaSk(shelfId: string): string {
  return `SHELFMETA#${shelfId}`;
}

function shelfMemberSk(shelfId: string, isbn: string): string {
  return `SMEMBER#${shelfId}#${isbn}`;
}

function bookPk(isbn: string): string {
  return `BOOK#${isbn}`;
}

const BOOK_SK = "METADATA";

// ── Shelf types ────────────────────────────────────────────────────────────

export interface ShelfEntry {
  isbn: string;
  status: ShelfStatus;
  addedAt: string;
  notes: string | null;
}

export interface BookMetadata {
  title: string;
  authors: string[];
  coverUrl: string | null;
  publishedYear: number | null;
  description: string | null;
}

export interface ShelfEntryWithBook extends ShelfEntry {
  book: BookMetadata | null;
}

export interface ShelfMeta {
  shelfId: string;
  name: string;
  createdAt: string;
}

export interface ShelfWithBookIds extends ShelfMeta {
  bookIds: string[];
}

// ── Coercion helpers ───────────────────────────────────────────────────────

const str = (v: unknown): string | null => (v != null ? String(v) : null);
const num = (v: unknown): number | null => (v != null ? Number(v) : null);

// ── Item mappers ───────────────────────────────────────────────────────────

function toShelfEntry(item: Record<string, unknown>): ShelfEntry {
  return {
    isbn: String(item["isbn"]),
    status: String(item["status"]) as ShelfStatus,
    addedAt: String(item["addedAt"]),
    notes: str(item["notes"]),
  };
}

function toBookMetadata(item: Record<string, unknown>): BookMetadata {
  return {
    title: String(item["title"]),
    authors: (item["authors"] as string[]) ?? [],
    coverUrl: str(item["coverUrl"]),
    publishedYear: num(item["publishedYear"]),
    description: str(item["description"]),
  };
}

function toShelfMeta(item: Record<string, unknown>): ShelfMeta {
  return {
    shelfId: String(item["shelfId"]),
    name: String(item["name"]),
    createdAt: String(item["createdAt"]),
  };
}

// ── Cursor helpers ─────────────────────────────────────────────────────────

/**
 * Thrown by {@link decodeCursor} when the cursor string is not a valid
 * base64url-encoded non-null JSON object. Route handlers should catch this
 * and return HTTP 400; any other error from {@link queryBookEntries} is a 500.
 */
export class InvalidCursorError extends Error {
  constructor(cause?: unknown) {
    super("Invalid pagination cursor");
    this.name = "InvalidCursorError";
    if (cause !== undefined) this.cause = cause;
  }
}

export function encodeCursor(key: Record<string, NativeAttributeValue>): string {
  return Buffer.from(JSON.stringify(key)).toString("base64url");
}

export function decodeCursor(cursor: string): Record<string, NativeAttributeValue> {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString()) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new InvalidCursorError();
    }
    return parsed as Record<string, NativeAttributeValue>;
  } catch (err) {
    if (err instanceof InvalidCursorError) throw err;
    throw new InvalidCursorError(err);
  }
}

// ── Book entry CRUD (new schema: ENTRY#<isbn>) ────────────────────────────

export interface QueryBookEntriesOptions {
  userId: string;
  status?: ShelfStatus;
  cursor?: string;
  limit?: number;
}

export interface QueryBookEntriesResult {
  entries: ShelfEntryWithBook[];
  nextCursor: string | null;
  total: number;
}

async function fetchBookMetadataMap(isbns: string[]): Promise<Record<string, BookMetadata>> {
  if (isbns.length === 0) return {};
  const bookMap: Record<string, BookMetadata> = {};
  const keys = isbns.map((isbn) => ({ PK: bookPk(isbn), SK: BOOK_SK }));
  const batchResult = await dynamo().send(
    new BatchGetCommand({ RequestItems: { [TABLE_NAME]: { Keys: keys } } }),
  );
  for (const book of (batchResult.Responses?.[TABLE_NAME] ?? []) as Record<string, unknown>[]) {
    bookMap[String(book["isbn"])] = toBookMetadata(book);
  }
  return bookMap;
}

export async function queryBookEntries(
  opts: QueryBookEntriesOptions,
): Promise<QueryBookEntriesResult> {
  const limit = Math.min(opts.limit ?? 20, 100);
  const pk = userPk(opts.userId);

  // Without status filter: use DynamoDB-native pagination with cursor
  if (!opts.status) {
    const baseQuery = {
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
      ExpressionAttributeValues: { ":pk": pk, ":prefix": "ENTRY#" },
    };
    const [queryResult, countResult] = await Promise.all([
      dynamo().send(
        new QueryCommand({
          ...baseQuery,
          Limit: limit,
          ExclusiveStartKey: opts.cursor ? decodeCursor(opts.cursor) : undefined,
        }),
      ),
      dynamo().send(new QueryCommand({ ...baseQuery, Select: "COUNT" })),
    ]);

    const items = (queryResult.Items ?? []) as Record<string, unknown>[];
    const entries = items.map(toShelfEntry);
    const bookMap = await fetchBookMetadataMap(entries.map((e) => e.isbn));

    return {
      entries: entries.map((e) => ({ ...e, book: bookMap[e.isbn] ?? null })),
      nextCursor: queryResult.LastEvaluatedKey ? encodeCursor(queryResult.LastEvaluatedKey) : null,
      total: countResult.Count ?? 0,
    };
  }

  // With status filter: loop through all DynamoDB pages to ensure completeness.
  // Filtered queries return all matching items at once (no cursor pagination).
  const allItems: Record<string, unknown>[] = [];
  let lastKey: Record<string, NativeAttributeValue> | undefined;
  do {
    const result = await dynamo().send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
        FilterExpression: "#status = :status",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: { ":pk": pk, ":prefix": "ENTRY#", ":status": opts.status },
        ExclusiveStartKey: lastKey,
      }),
    );
    allItems.push(...((result.Items ?? []) as Record<string, unknown>[]));
    lastKey = result.LastEvaluatedKey as Record<string, NativeAttributeValue> | undefined;
  } while (lastKey);

  const entries = allItems.map(toShelfEntry);
  const bookMap = await fetchBookMetadataMap(entries.map((e) => e.isbn));

  return {
    entries: entries.map((e) => ({ ...e, book: bookMap[e.isbn] ?? null })),
    nextCursor: null,
    total: entries.length,
  };
}

export async function getBookEntry(userId: string, isbn: string): Promise<ShelfEntry | null> {
  const result = await dynamo().send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: userPk(userId), SK: entrySk(isbn) },
    }),
  );
  return result.Item ? toShelfEntry(result.Item as Record<string, unknown>) : null;
}

export async function putBookEntry(
  userId: string,
  isbn: string,
  status: ShelfStatus,
  addedAt: string,
): Promise<void> {
  await dynamo().send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: { PK: userPk(userId), SK: entrySk(isbn), isbn, status, addedAt, notes: null },
      ConditionExpression: "attribute_not_exists(PK)",
    }),
  );
}

export async function updateBookEntryStatus(
  userId: string,
  isbn: string,
  newStatus: ShelfStatus,
): Promise<void> {
  await dynamo().send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: userPk(userId), SK: entrySk(isbn) },
      UpdateExpression: "SET #status = :status",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: { ":status": newStatus },
      ConditionExpression: "attribute_exists(PK)",
    }),
  );
}

export async function updateBookEntryNotes(
  userId: string,
  isbn: string,
  notes: string | null,
): Promise<void> {
  await dynamo().send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: userPk(userId), SK: entrySk(isbn) },
      UpdateExpression: notes !== null ? "SET notes = :notes" : "REMOVE notes",
      ...(notes !== null ? { ExpressionAttributeValues: { ":notes": notes } } : {}),
      ConditionExpression: "attribute_exists(PK)",
    }),
  );
}

export async function deleteBookEntry(userId: string, isbn: string): Promise<void> {
  // Collect all SMEMBER# items for this user, then filter for this isbn.
  // Must paginate in case the user has a very large number of shelf memberships.
  const memberKeys: Array<Record<string, string>> = [];
  let lastKey: Record<string, NativeAttributeValue> | undefined;
  do {
    const result = await dynamo().send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
        ExpressionAttributeValues: { ":pk": userPk(userId), ":prefix": "SMEMBER#" },
        ExclusiveStartKey: lastKey,
      }),
    );
    for (const item of result.Items ?? []) {
      if ((item["SK"] as string).endsWith(`#${isbn}`)) {
        memberKeys.push({ PK: item["PK"] as string, SK: item["SK"] as string });
      }
    }
    lastKey = result.LastEvaluatedKey as Record<string, NativeAttributeValue> | undefined;
  } while (lastKey);

  const allKeys = [{ PK: userPk(userId), SK: entrySk(isbn) }, ...memberKeys];

  for (let i = 0; i < allKeys.length; i += 25) {
    const chunk = allKeys.slice(i, i + 25);
    await dynamo().send(
      new BatchWriteCommand({
        RequestItems: {
          [TABLE_NAME]: chunk.map((Key) => ({ DeleteRequest: { Key } })),
        },
      }),
    );
  }
}

// ── Named shelf CRUD (SHELFMETA#<shelfId>) ────────────────────────────────

export async function queryShelvesMeta(userId: string): Promise<ShelfMeta[]> {
  const result = await dynamo().send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
      ExpressionAttributeValues: {
        ":pk": userPk(userId),
        ":prefix": "SHELFMETA#",
      },
    }),
  );
  return (result.Items ?? []).map((i) => toShelfMeta(i as Record<string, unknown>));
}

export async function getShelfMetaItem(userId: string, shelfId: string): Promise<ShelfMeta | null> {
  const result = await dynamo().send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: userPk(userId), SK: shelfMetaSk(shelfId) },
    }),
  );
  return result.Item ? toShelfMeta(result.Item as Record<string, unknown>) : null;
}

export async function putShelfMeta(
  userId: string,
  shelfId: string,
  name: string,
  createdAt: string,
): Promise<void> {
  await dynamo().send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: { PK: userPk(userId), SK: shelfMetaSk(shelfId), shelfId, name, createdAt },
    }),
  );
}

export async function updateShelfMetaName(
  userId: string,
  shelfId: string,
  name: string,
): Promise<void> {
  await dynamo().send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: userPk(userId), SK: shelfMetaSk(shelfId) },
      UpdateExpression: "SET #name = :name",
      ExpressionAttributeNames: { "#name": "name" },
      ExpressionAttributeValues: { ":name": name },
      ConditionExpression: "attribute_exists(PK)",
    }),
  );
}

export async function deleteShelfAndMembers(userId: string, shelfId: string): Promise<void> {
  const memberResult = await dynamo().send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
      ExpressionAttributeValues: {
        ":pk": userPk(userId),
        ":prefix": `SMEMBER#${shelfId}#`,
      },
    }),
  );

  const allKeys = [
    { PK: userPk(userId), SK: shelfMetaSk(shelfId) },
    ...(memberResult.Items ?? []).map((item) => ({
      PK: item["PK"] as string,
      SK: item["SK"] as string,
    })),
  ];

  for (let i = 0; i < allKeys.length; i += 25) {
    const chunk = allKeys.slice(i, i + 25);
    await dynamo().send(
      new BatchWriteCommand({
        RequestItems: {
          [TABLE_NAME]: chunk.map((Key) => ({ DeleteRequest: { Key } })),
        },
      }),
    );
  }
}

// ── Shelf membership CRUD (SMEMBER#<shelfId>#<isbn>) ──────────────────────

export async function batchGetBookEntries(
  userId: string,
  isbns: string[],
): Promise<ShelfEntryWithBook[]> {
  if (isbns.length === 0) return [];

  const entryKeys = isbns.map((isbn) => ({ PK: userPk(userId), SK: entrySk(isbn) }));
  const bookMetaKeys = isbns.map((isbn) => ({ PK: bookPk(isbn), SK: BOOK_SK }));

  const [entryResult, metaResult] = await Promise.all([
    dynamo().send(
      new BatchGetCommand({ RequestItems: { [TABLE_NAME]: { Keys: entryKeys } } }),
    ),
    dynamo().send(
      new BatchGetCommand({ RequestItems: { [TABLE_NAME]: { Keys: bookMetaKeys } } }),
    ),
  ]);

  const bookMap: Record<string, BookMetadata> = {};
  for (const book of (metaResult.Responses?.[TABLE_NAME] ?? []) as Record<string, unknown>[]) {
    bookMap[String(book["isbn"])] = toBookMetadata(book);
  }

  return (entryResult.Responses?.[TABLE_NAME] ?? [])
    .map((item) => {
      const entry = toShelfEntry(item as Record<string, unknown>);
      return { ...entry, book: bookMap[entry.isbn] ?? null };
    });
}

export async function queryShelfMemberIsns(userId: string, shelfId: string): Promise<string[]> {
  const result = await dynamo().send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
      ExpressionAttributeValues: {
        ":pk": userPk(userId),
        ":prefix": `SMEMBER#${shelfId}#`,
      },
    }),
  );
  return (result.Items ?? []).map((item) => String(item["isbn"]));
}

export async function queryAllShelvesWithBookIds(userId: string): Promise<ShelfWithBookIds[]> {
  const shelves = await queryShelvesMeta(userId);
  if (shelves.length === 0) return [];

  const memberResults = await Promise.all(
    shelves.map((s) =>
      dynamo().send(
        new QueryCommand({
          TableName: TABLE_NAME,
          KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
          ExpressionAttributeValues: {
            ":pk": userPk(userId),
            ":prefix": `SMEMBER#${s.shelfId}#`,
          },
        }),
      ),
    ),
  );

  return shelves.map((shelf, i) => ({
    ...shelf,
    bookIds: (memberResults[i]?.Items ?? []).map((item) => String(item["isbn"])),
  }));
}

export async function putShelfMember(userId: string, shelfId: string, isbn: string): Promise<void> {
  await dynamo().send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: userPk(userId),
        SK: shelfMemberSk(shelfId, isbn),
        shelfId,
        isbn,
      },
    }),
  );
}

export async function deleteShelfMember(
  userId: string,
  shelfId: string,
  isbn: string,
): Promise<void> {
  await dynamo().send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { PK: userPk(userId), SK: shelfMemberSk(shelfId, isbn) },
    }),
  );
}

// ── Account deletion ───────────────────────────────────────────────────────

export async function deleteAllUserData(userId: string): Promise<void> {
  const pk = userPk(userId);
  let lastKey: Record<string, NativeAttributeValue> | undefined;

  do {
    const result = await dynamo().send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: { ":pk": pk },
        ProjectionExpression: "PK, SK",
        ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
      }),
    );

    const items = (result.Items ?? []) as Array<Record<string, NativeAttributeValue>>;
    lastKey = result.LastEvaluatedKey as Record<string, NativeAttributeValue> | undefined;

    // BatchWriteItem supports up to 25 delete requests per call.
    // Retry UnprocessedItems with backoff — DynamoDB may return partial results under load.
    for (let i = 0; i < items.length; i += 25) {
      const chunk = items.slice(i, i + 25);
      let unprocessed = chunk.map((item) => ({
        DeleteRequest: { Key: { PK: item["PK"], SK: item["SK"] } },
      }));
      let delay = 50;
      while (unprocessed.length > 0) {
        const result = await dynamo().send(
          new BatchWriteCommand({ RequestItems: { [TABLE_NAME]: unprocessed } }),
        );
        unprocessed = (result.UnprocessedItems?.[TABLE_NAME] ?? []) as typeof unprocessed;
        if (unprocessed.length > 0) {
          await new Promise((r) => setTimeout(r, delay));
          delay = Math.min(delay * 2, 2000);
        }
      }
    }
  } while (lastKey);
}

// ── Book metadata cache ────────────────────────────────────────────────────

export async function putBookMetadata(
  isbn: string,
  metadata: BookMetadata,
  cachedAt: string,
): Promise<void> {
  await dynamo().send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: { PK: bookPk(isbn), SK: BOOK_SK, isbn, ...metadata, cachedAt },
    }),
  );
}
