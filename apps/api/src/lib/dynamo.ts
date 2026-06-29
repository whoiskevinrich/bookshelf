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

export type ReadingStatus = "unread" | "reading" | "finished";

export function isValidReadingStatus(s: unknown): s is ReadingStatus {
  return s === "unread" || s === "reading" || s === "finished";
}

/**
 * The deprecated `status` enum derived from the `owned` attribute (ADR-019):
 * owned → "owned", otherwise "want". Emitted for one transition release so legacy
 * clients keep working; removed once the web client migrates (ADR-019 action item 8).
 */
export function derivedStatus(owned: boolean): ShelfStatus {
  return owned ? "owned" : "want";
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

function smartShelfSk(smartShelfId: string): string {
  return `SMARTSHELF#${smartShelfId}`;
}

function bookPk(isbn: string): string {
  return `BOOK#${isbn}`;
}

const BOOK_SK = "METADATA";

// ── Shelf types ────────────────────────────────────────────────────────────

export interface ShelfEntry {
  isbn: string;
  /** Independent attribute (ADR-019). Was the `status === "owned"` enum branch. */
  owned: boolean;
  /** Independent attribute (ADR-019). Was the `status === "want"` enum branch. */
  want: boolean;
  readingStatus: ReadingStatus | null;
  /** Normalized tags (ADR-019). Always present; empty when the entry has none. */
  tags: string[];
  addedAt: string;
  notes: string | null;
  /** @deprecated Derived from `owned`/`want` for one transition release (ADR-019). */
  status: ShelfStatus;
}

/** Attributes accepted when creating a new entry. At least one of owned/want is true. */
export interface NewEntryAttributes {
  owned: boolean;
  want: boolean;
  readingStatus?: ReadingStatus | null;
}

/** Partial attribute update for an existing entry; only present fields are written. */
export interface EntryAttributePatch {
  owned?: boolean;
  want?: boolean;
  readingStatus?: ReadingStatus | null;
}

/** In-memory filter applied to the user's entries (ADR-019 — no GSI). */
export interface EntryFilter {
  owned?: boolean;
  want?: boolean;
  readingStatus?: ReadingStatus;
  /** Normalized tag the entry must carry. */
  tag?: string;
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
  /** Ascending sort position. Absent on legacy items; those fall back to createdAt epoch ms. */
  sortOrder?: number;
}

export interface ShelfWithBookIds extends ShelfMeta {
  bookIds: string[];
}

// ── Coercion helpers ───────────────────────────────────────────────────────

const str = (v: unknown): string | null => (v != null ? String(v) : null);
const num = (v: unknown): number | null => (v != null ? Number(v) : null);

// ── Item mappers ───────────────────────────────────────────────────────────

/** Normalize a tag: trim, lowercase, collapse internal whitespace (Q2 anti-duplication). */
export function normalizeTag(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Coerce a stored tags attribute (DynamoDB String Set → JS Set, or array) to a sorted string[]. */
function toTags(v: unknown): string[] {
  if (v instanceof Set) return [...(v as Set<string>)].sort();
  if (Array.isArray(v)) return (v as unknown[]).map(String).sort();
  return [];
}

function toShelfEntry(item: Record<string, unknown>): ShelfEntry {
  // Dual-read (ADR-019): migrated items carry `owned`/`want` booleans; legacy
  // items carry only the `status` enum. Derive from whichever is present so the
  // API is correct before, during, and after the backfill.
  const hasNewFields = item["owned"] !== undefined || item["want"] !== undefined;
  const legacyStatus = item["status"];
  const owned = hasNewFields ? Boolean(item["owned"]) : legacyStatus === "owned";
  const want = hasNewFields ? Boolean(item["want"]) : legacyStatus === "want";
  const readingStatus = isValidReadingStatus(item["readingStatus"]) ? item["readingStatus"] : null;

  return {
    isbn: String(item["isbn"]),
    owned,
    want,
    readingStatus,
    tags: toTags(item["tags"]),
    addedAt: String(item["addedAt"]),
    notes: str(item["notes"]),
    status: derivedStatus(owned),
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
    ...(item["sortOrder"] != null ? { sortOrder: Number(item["sortOrder"]) } : {}),
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
  filter?: EntryFilter;
  cursor?: string;
  limit?: number;
}

export interface QueryBookEntriesResult {
  entries: ShelfEntryWithBook[];
  nextCursor: string | null;
  total: number;
}

/** True when the entry satisfies every present field of the filter. */
export function matchesFilter(entry: ShelfEntry, filter: EntryFilter): boolean {
  if (filter.owned !== undefined && entry.owned !== filter.owned) return false;
  if (filter.want !== undefined && entry.want !== filter.want) return false;
  if (filter.readingStatus !== undefined && entry.readingStatus !== filter.readingStatus) {
    return false;
  }
  if (filter.tag !== undefined && !entry.tags.includes(filter.tag)) return false;
  return true;
}

function hasAnyFilter(filter?: EntryFilter): filter is EntryFilter {
  return (
    filter !== undefined &&
    (filter.owned !== undefined ||
      filter.want !== undefined ||
      filter.readingStatus !== undefined ||
      filter.tag !== undefined)
  );
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

  // Unfiltered: DynamoDB-native cursor pagination (bounded response for large shelves).
  if (!hasAnyFilter(opts.filter)) {
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

  // Filtered: loop all pages, then filter in memory on the *derived* attributes
  // (ADR-019). A server-side FilterExpression on `owned`/`want` would miss legacy
  // un-migrated items that still carry only the `status` enum; filtering after
  // toShelfEntry's dual-read keeps results correct across the migration window.
  // Filtered queries return all matching items at once (no cursor pagination).
  const filter = opts.filter;
  const allItems: Record<string, unknown>[] = [];
  let lastKey: Record<string, NativeAttributeValue> | undefined;
  do {
    const result = await dynamo().send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
        ExpressionAttributeValues: { ":pk": pk, ":prefix": "ENTRY#" },
        ExclusiveStartKey: lastKey,
      }),
    );
    allItems.push(...((result.Items ?? []) as Record<string, unknown>[]));
    lastKey = result.LastEvaluatedKey as Record<string, NativeAttributeValue> | undefined;
  } while (lastKey);

  const entries = allItems.map(toShelfEntry).filter((e) => matchesFilter(e, filter));
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
  attrs: NewEntryAttributes,
  addedAt: string,
): Promise<void> {
  await dynamo().send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: userPk(userId),
        SK: entrySk(isbn),
        isbn,
        owned: attrs.owned,
        want: attrs.want,
        readingStatus: attrs.readingStatus ?? null,
        addedAt,
        notes: null,
      },
      ConditionExpression: "attribute_not_exists(PK)",
    }),
  );
}

/**
 * Apply a partial attribute update (owned / want / readingStatus). Only the
 * fields present in `patch` are written; `readingStatus: null` is stored as NULL
 * (consistent with create), not removed. No-op if `patch` is empty.
 */
export async function updateBookEntryAttributes(
  userId: string,
  isbn: string,
  patch: EntryAttributePatch,
): Promise<void> {
  const sets: string[] = [];
  const names: Record<string, string> = {};
  const values: Record<string, NativeAttributeValue> = {};

  if (patch.owned !== undefined) {
    sets.push("#owned = :owned");
    names["#owned"] = "owned";
    values[":owned"] = patch.owned;
  }
  if (patch.want !== undefined) {
    sets.push("#want = :want");
    names["#want"] = "want";
    values[":want"] = patch.want;
  }
  if (patch.readingStatus !== undefined) {
    sets.push("#readingStatus = :readingStatus");
    names["#readingStatus"] = "readingStatus";
    values[":readingStatus"] = patch.readingStatus;
  }

  if (sets.length === 0) return;

  await dynamo().send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: userPk(userId), SK: entrySk(isbn) },
      UpdateExpression: "SET " + sets.join(", "),
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
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

/**
 * Replace an entry's tag set (ADR-019). Caller passes the full normalized list.
 * An empty list **removes** the `tags` attribute — DynamoDB cannot store an empty
 * String Set, so we must `REMOVE` rather than write `new Set([])`.
 */
export async function updateBookEntryTags(
  userId: string,
  isbn: string,
  tags: string[],
): Promise<void> {
  const base = {
    TableName: TABLE_NAME,
    Key: { PK: userPk(userId), SK: entrySk(isbn) },
    ConditionExpression: "attribute_exists(PK)",
  };
  if (tags.length === 0) {
    await dynamo().send(new UpdateCommand({ ...base, UpdateExpression: "REMOVE tags" }));
    return;
  }
  await dynamo().send(
    new UpdateCommand({
      ...base,
      UpdateExpression: "SET tags = :tags",
      // A JS Set marshals to a DynamoDB String Set (SS) via the Document client.
      ExpressionAttributeValues: { ":tags": new Set(tags) },
    }),
  );
}

export interface TagCount {
  tag: string;
  count: number;
}

/**
 * The user's distinct tags with usage counts, derived by scanning their `ENTRY#`
 * items (ADR-019 — no separate tag registry). Sorted by count desc, then alpha.
 * Stored tags are already normalized at the write boundary, so no re-normalization.
 */
export async function queryDistinctTags(userId: string): Promise<TagCount[]> {
  const counts = new Map<string, number>();
  let lastKey: Record<string, NativeAttributeValue> | undefined;
  do {
    const result = await dynamo().send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
        ExpressionAttributeValues: { ":pk": userPk(userId), ":prefix": "ENTRY#" },
        ProjectionExpression: "tags",
        ExclusiveStartKey: lastKey,
      }),
    );
    for (const item of (result.Items ?? []) as Record<string, unknown>[]) {
      for (const tag of toTags(item["tags"])) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    lastKey = result.LastEvaluatedKey as Record<string, NativeAttributeValue> | undefined;
  } while (lastKey);

  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
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
  const shelves = (result.Items ?? []).map((i) => toShelfMeta(i as Record<string, unknown>));
  // Sort by sortOrder; fall back to createdAt epoch ms for legacy items without the field.
  return shelves.sort(
    (a, b) => (a.sortOrder ?? Date.parse(a.createdAt)) - (b.sortOrder ?? Date.parse(b.createdAt)),
  );
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
  sortOrder: number,
): Promise<void> {
  await dynamo().send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: { PK: userPk(userId), SK: shelfMetaSk(shelfId), shelfId, name, createdAt, sortOrder },
    }),
  );
}

export async function updateShelfSortOrder(
  userId: string,
  shelfId: string,
  sortOrder: number,
): Promise<void> {
  await dynamo().send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: userPk(userId), SK: shelfMetaSk(shelfId) },
      UpdateExpression: "SET sortOrder = :sortOrder",
      ExpressionAttributeValues: { ":sortOrder": sortOrder },
      ConditionExpression: "attribute_exists(PK)",
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
    dynamo().send(new BatchGetCommand({ RequestItems: { [TABLE_NAME]: { Keys: entryKeys } } })),
    dynamo().send(new BatchGetCommand({ RequestItems: { [TABLE_NAME]: { Keys: bookMetaKeys } } })),
  ]);

  const bookMap: Record<string, BookMetadata> = {};
  for (const book of (metaResult.Responses?.[TABLE_NAME] ?? []) as Record<string, unknown>[]) {
    bookMap[String(book["isbn"])] = toBookMetadata(book);
  }

  return (entryResult.Responses?.[TABLE_NAME] ?? []).map((item) => {
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

// ── Smart shelves (SMARTSHELF#<id>) — saved filter rules (ADR-019 §2) ────────

/** A saved filter rule. Same shape as the in-memory {@link EntryFilter}. */
export type SmartShelfRule = EntryFilter;

export interface SmartShelf {
  smartShelfId: string;
  name: string;
  rule: SmartShelfRule;
  createdAt: string;
}

export interface SmartShelfWithCount extends SmartShelf {
  /** Live count of entries matching the rule. */
  count: number;
}

function toSmartShelf(item: Record<string, unknown>): SmartShelf {
  return {
    smartShelfId: String(item["smartShelfId"]),
    name: String(item["name"]),
    rule: (item["rule"] ?? {}) as SmartShelfRule,
    createdAt: String(item["createdAt"]),
  };
}

/** All of the user's `ENTRY#` items mapped to {@link ShelfEntry} (no book metadata). */
export async function queryAllEntries(userId: string): Promise<ShelfEntry[]> {
  const entries: ShelfEntry[] = [];
  let lastKey: Record<string, NativeAttributeValue> | undefined;
  do {
    const result = await dynamo().send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
        ExpressionAttributeValues: { ":pk": userPk(userId), ":prefix": "ENTRY#" },
        ExclusiveStartKey: lastKey,
      }),
    );
    for (const item of (result.Items ?? []) as Record<string, unknown>[]) {
      entries.push(toShelfEntry(item));
    }
    lastKey = result.LastEvaluatedKey as Record<string, NativeAttributeValue> | undefined;
  } while (lastKey);
  return entries;
}

export async function querySmartShelves(userId: string): Promise<SmartShelf[]> {
  const result = await dynamo().send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
      ExpressionAttributeValues: { ":pk": userPk(userId), ":prefix": "SMARTSHELF#" },
    }),
  );
  return (result.Items ?? [])
    .map((i) => toSmartShelf(i as Record<string, unknown>))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** List smart shelves with a live match count, computed from a single entry scan. */
export async function querySmartShelvesWithCounts(userId: string): Promise<SmartShelfWithCount[]> {
  const shelves = await querySmartShelves(userId);
  // Skip the full entry scan entirely when there are no rules to evaluate.
  if (shelves.length === 0) return [];
  const entries = await queryAllEntries(userId);
  return shelves.map((s) => ({
    ...s,
    count: entries.filter((e) => matchesFilter(e, s.rule)).length,
  }));
}

export async function getSmartShelf(
  userId: string,
  smartShelfId: string,
): Promise<SmartShelf | null> {
  const result = await dynamo().send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: userPk(userId), SK: smartShelfSk(smartShelfId) },
    }),
  );
  return result.Item ? toSmartShelf(result.Item as Record<string, unknown>) : null;
}

export async function putSmartShelf(
  userId: string,
  smartShelfId: string,
  name: string,
  rule: SmartShelfRule,
  createdAt: string,
): Promise<void> {
  await dynamo().send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: userPk(userId),
        SK: smartShelfSk(smartShelfId),
        smartShelfId,
        name,
        rule,
        createdAt,
      },
    }),
  );
}

export async function updateSmartShelfName(
  userId: string,
  smartShelfId: string,
  name: string,
): Promise<void> {
  await dynamo().send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: userPk(userId), SK: smartShelfSk(smartShelfId) },
      UpdateExpression: "SET #name = :name",
      ExpressionAttributeNames: { "#name": "name" },
      ExpressionAttributeValues: { ":name": name },
      ConditionExpression: "attribute_exists(PK)",
    }),
  );
}

export async function deleteSmartShelf(userId: string, smartShelfId: string): Promise<void> {
  await dynamo().send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { PK: userPk(userId), SK: smartShelfSk(smartShelfId) },
    }),
  );
}
