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

function shelfSk(status: ShelfStatus, isbn: string): string {
  return `SHELF#${status}#${isbn}`;
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

function shelfItem(
  userId: string,
  isbn: string,
  status: ShelfStatus,
  addedAt: string,
  notes: string | null = null,
) {
  return {
    PK: userPk(userId),
    SK: shelfSk(status, isbn),
    isbn,
    status,
    addedAt,
    notes,
  };
}

// ── Cursor helpers ─────────────────────────────────────────────────────────

/**
 * Thrown by {@link decodeCursor} when the cursor string is not a valid
 * base64url-encoded non-null JSON object. Route handlers should catch this
 * and return HTTP 400; any other error from {@link queryShelf} is a 500.
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

// ── Shelf CRUD ─────────────────────────────────────────────────────────────

export interface QueryShelfOptions {
  userId: string;
  status?: ShelfStatus;
  cursor?: string;
  limit?: number;
}

export interface QueryShelfResult {
  entries: ShelfEntryWithBook[];
  nextCursor: string | null;
  total: number;
}

/**
 * Query a user's shelf with optional status filter and cursor-based pagination.
 * @throws {InvalidCursorError} if opts.cursor is present but malformed
 */
export async function queryShelf(opts: QueryShelfOptions): Promise<QueryShelfResult> {
  const limit = Math.min(opts.limit ?? 20, 100);
  const skPrefix = opts.status ? `SHELF#${opts.status}#` : "SHELF#";
  const baseQuery = {
    TableName: TABLE_NAME,
    KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
    ExpressionAttributeValues: {
      ":pk": userPk(opts.userId),
      ":prefix": skPrefix,
    },
  };

  // Data query and count query run in parallel
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

  const items = queryResult.Items ?? [];
  const entries = items.map(toShelfEntry);

  // Fetch book metadata in a single BatchGetItem
  const bookMap: Record<string, BookMetadata> = {};
  if (entries.length > 0) {
    const keys = entries.map((e) => ({ PK: bookPk(e.isbn), SK: BOOK_SK }));
    const batchResult = await dynamo().send(
      new BatchGetCommand({ RequestItems: { [TABLE_NAME]: { Keys: keys } } }),
    );
    for (const book of batchResult.Responses?.[TABLE_NAME] ?? []) {
      bookMap[String(book["isbn"])] = toBookMetadata(book);
    }
  }

  return {
    entries: entries.map((e) => ({ ...e, book: bookMap[e.isbn] ?? null })),
    nextCursor: queryResult.LastEvaluatedKey ? encodeCursor(queryResult.LastEvaluatedKey) : null,
    total: countResult.Count ?? 0,
  };
}

export async function getShelfEntry(userId: string, isbn: string): Promise<ShelfEntry | null> {
  // Both status keys are probed in parallel — we don't know which prefix applies
  const [r1, r2] = await Promise.all(
    (["owned", "want"] as ShelfStatus[]).map((status) =>
      dynamo().send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: { PK: userPk(userId), SK: shelfSk(status, isbn) },
        }),
      ),
    ),
  );
  const item = r1?.Item ?? r2?.Item ?? null;
  return item ? toShelfEntry(item) : null;
}

export async function putShelfEntry(
  userId: string,
  isbn: string,
  status: ShelfStatus,
  addedAt: string,
): Promise<void> {
  await dynamo().send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: shelfItem(userId, isbn, status, addedAt),
      // Fail if entry already exists (either status)
      ConditionExpression: "attribute_not_exists(PK)",
    }),
  );
}

export async function deleteShelfEntry(
  userId: string,
  isbn: string,
  status: ShelfStatus,
): Promise<void> {
  await dynamo().send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { PK: userPk(userId), SK: shelfSk(status, isbn) },
    }),
  );
}

export async function updateShelfStatus(
  userId: string,
  isbn: string,
  oldStatus: ShelfStatus,
  newStatus: ShelfStatus,
  addedAt: string,
  notes: string | null = null,
): Promise<void> {
  // DynamoDB has no rename-key operation — delete old SK, put new SK
  await deleteShelfEntry(userId, isbn, oldStatus);
  await dynamo().send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: shelfItem(userId, isbn, newStatus, addedAt, notes),
    }),
  );
}

export async function updateShelfNotes(
  userId: string,
  isbn: string,
  status: ShelfStatus,
  notes: string | null,
): Promise<void> {
  await dynamo().send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: userPk(userId), SK: shelfSk(status, isbn) },
      UpdateExpression: notes !== null ? "SET notes = :notes" : "REMOVE notes",
      ...(notes !== null ? { ExpressionAttributeValues: { ":notes": notes } } : {}),
      ConditionExpression: "attribute_exists(PK)",
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
