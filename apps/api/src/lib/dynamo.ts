import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  GetCommand,
  PutCommand,
  DeleteCommand,
  BatchGetCommand,
  type NativeAttributeValue,
} from "@aws-sdk/lib-dynamodb";

// Lazy-initialized so that env vars loaded by dotenv in server.ts take effect
// before the client is constructed. ESM imports are hoisted, so top-level
// initialization runs before dotenv's config() call in server.ts.
let _dynamo: DynamoDBDocumentClient | undefined;

export function dynamo(): DynamoDBDocumentClient {
  if (!_dynamo) {
    const endpoint = process.env["DYNAMODB_ENDPOINT"];
    const client = new DynamoDBClient(
      endpoint
        ? {
            endpoint,
            region: "us-east-1",
            credentials: {
              accessKeyId: "DUMMYACCESSKEYID0001",
              secretAccessKey: "dummysecretaccesskey0001",
            },
          }
        : {},
    );
    _dynamo = DynamoDBDocumentClient.from(client);
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

export function encodeCursor(key: Record<string, NativeAttributeValue>): string {
  return Buffer.from(JSON.stringify(key)).toString("base64url");
}

export function decodeCursor(cursor: string): Record<string, NativeAttributeValue> {
  return JSON.parse(Buffer.from(cursor, "base64url").toString()) as Record<
    string,
    NativeAttributeValue
  >;
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
