import { getSession } from "./auth";
import { getRuntimeConfig } from "./runtime-config";

// ── Types ──────────────────────────────────────────────────────────────────

export type ShelfStatus = "owned" | "want";

export type ReadingStatus = "unread" | "reading" | "finished";

export interface BookMetadata {
  title: string;
  authors: string[];
  coverUrl: string | null;
  publishedYear: number | null;
  description: string | null;
}

export interface ShelfEntry {
  isbn: string;
  /** Independent attribute (ADR-019). */
  owned: boolean;
  /** Independent attribute (ADR-019). */
  want: boolean;
  readingStatus: ReadingStatus | null;
  /** Normalized tags; empty when none. */
  tags: string[];
  addedAt: string;
  notes: string | null;
  /** @deprecated Derived from owned/want during the transition (ADR-019). */
  status: ShelfStatus;
  book: BookMetadata | null;
}

export interface ShelfPage {
  entries: ShelfEntry[];
  nextCursor: string | null;
  total: number;
}

export interface BookSearchResult {
  isbn: string;
  title: string;
  authors: string[];
  coverUrl: string | null;
  publishedYear: number | null;
  description: string | null;
}

export interface Shelf {
  shelfId: string;
  name: string;
  createdAt: string;
  bookIds: string[];
  sortOrder?: number;
}

// ── Errors ────────────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// ── Internal ───────────────────────────────────────────────────────────────

async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = await getSession();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${getRuntimeConfig().apiBaseUrl}${path}`, { ...init, headers });
  return res;
}

async function throwIfError(res: Response): Promise<void> {
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // ignore
    }
    throw new ApiError(res.status, message);
  }
}

// ── Shelf API ──────────────────────────────────────────────────────────────

/** A combinable filter over shelf entries (ADR-019 — system facets + tag). */
export interface ShelfFilter {
  owned?: boolean;
  want?: boolean;
  readingStatus?: ReadingStatus;
  tag?: string;
}

export async function fetchShelf(
  opts: ShelfFilter & { status?: ShelfStatus; cursor?: string; limit?: number },
): Promise<ShelfPage> {
  const params = new URLSearchParams();
  if (opts.status) params.set("status", opts.status);
  if (opts.owned !== undefined) params.set("owned", String(opts.owned));
  if (opts.want !== undefined) params.set("want", String(opts.want));
  if (opts.readingStatus) params.set("readingStatus", opts.readingStatus);
  if (opts.tag) params.set("tag", opts.tag);
  if (opts.cursor) params.set("cursor", opts.cursor);
  if (opts.limit) params.set("limit", String(opts.limit));
  // URLSearchParams encodes spaces as "+", which Hono decodes literally (not as a
  // space) — breaking multi-word tag filters like "science fiction". Force %20.
  const qs = params.toString().replace(/\+/g, "%20");
  const res = await authedFetch(`/v1/shelf${qs ? `?${qs}` : ""}`);
  await throwIfError(res);
  return res.json() as Promise<ShelfPage>;
}

export async function addToShelf(
  isbn: string,
  status: ShelfStatus,
  book?: BookMetadata,
): Promise<ShelfEntry> {
  const res = await authedFetch("/v1/shelf", {
    method: "POST",
    body: JSON.stringify({ isbn, status, ...(book ? { book } : {}) }),
  });
  await throwIfError(res);
  return res.json() as Promise<ShelfEntry>;
}

export async function updateShelfStatus(isbn: string, status: ShelfStatus): Promise<ShelfEntry> {
  const res = await authedFetch(`/v1/shelf/${isbn}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
  await throwIfError(res);
  return res.json() as Promise<ShelfEntry>;
}

export async function fetchShelfEntry(isbn: string): Promise<ShelfEntry> {
  const res = await authedFetch(`/v1/shelf/${encodeURIComponent(isbn)}`);
  await throwIfError(res);
  return res.json() as Promise<ShelfEntry>;
}

export interface EntryAttributes {
  owned?: boolean;
  want?: boolean;
  readingStatus?: ReadingStatus | null;
}

export async function updateShelfAttributes(
  isbn: string,
  attrs: EntryAttributes,
): Promise<ShelfEntry> {
  const res = await authedFetch(`/v1/shelf/${encodeURIComponent(isbn)}`, {
    method: "PATCH",
    body: JSON.stringify(attrs),
  });
  await throwIfError(res);
  return res.json() as Promise<ShelfEntry>;
}

export async function updateShelfTags(isbn: string, tags: string[]): Promise<ShelfEntry> {
  const res = await authedFetch(`/v1/shelf/${encodeURIComponent(isbn)}/tags`, {
    method: "PATCH",
    body: JSON.stringify({ tags }),
  });
  await throwIfError(res);
  return res.json() as Promise<ShelfEntry>;
}

export async function updateShelfNotes(isbn: string, notes: string | null): Promise<ShelfEntry> {
  const res = await authedFetch(`/v1/shelf/${encodeURIComponent(isbn)}/notes`, {
    method: "PATCH",
    body: JSON.stringify({ notes }),
  });
  await throwIfError(res);
  return res.json() as Promise<ShelfEntry>;
}

export interface TagCount {
  tag: string;
  count: number;
}

export async function fetchTags(): Promise<TagCount[]> {
  const res = await authedFetch("/v1/tags");
  await throwIfError(res);
  const body = (await res.json()) as { tags: TagCount[] };
  return body.tags;
}

export async function removeFromShelf(isbn: string): Promise<void> {
  const res = await authedFetch(`/v1/shelf/${isbn}`, { method: "DELETE" });
  if (res.status === 204) return;
  await throwIfError(res);
}

// ── Named shelves API ─────────────────────────────────────────────────────

export async function fetchShelves(): Promise<Shelf[]> {
  const res = await authedFetch("/v1/shelves");
  await throwIfError(res);
  return res.json() as Promise<Shelf[]>;
}

export async function createShelf(name: string): Promise<Shelf> {
  const res = await authedFetch("/v1/shelves", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  await throwIfError(res);
  return res.json() as Promise<Shelf>;
}

export async function updateShelf(shelfId: string, name: string): Promise<Shelf> {
  const res = await authedFetch(`/v1/shelves/${encodeURIComponent(shelfId)}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
  await throwIfError(res);
  return res.json() as Promise<Shelf>;
}

export async function reorderShelves(order: string[]): Promise<void> {
  const res = await authedFetch("/v1/shelves/reorder", {
    method: "POST",
    body: JSON.stringify({ order }),
  });
  if (res.status === 204) return;
  await throwIfError(res);
}

export async function deleteShelf(shelfId: string): Promise<void> {
  const res = await authedFetch(`/v1/shelves/${encodeURIComponent(shelfId)}`, {
    method: "DELETE",
  });
  if (res.status === 204) return;
  await throwIfError(res);
}

export async function addBookToShelf(shelfId: string, isbn: string): Promise<void> {
  const res = await authedFetch(
    `/v1/shelves/${encodeURIComponent(shelfId)}/books/${encodeURIComponent(isbn)}`,
    { method: "POST" },
  );
  if (res.status === 204) return;
  await throwIfError(res);
}

export async function removeBookFromShelf(shelfId: string, isbn: string): Promise<void> {
  const res = await authedFetch(
    `/v1/shelves/${encodeURIComponent(shelfId)}/books/${encodeURIComponent(isbn)}`,
    { method: "DELETE" },
  );
  if (res.status === 204) return;
  await throwIfError(res);
}

export async function fetchShelfBooks(shelfId: string): Promise<ShelfEntry[]> {
  const res = await authedFetch(`/v1/shelves/${encodeURIComponent(shelfId)}/books`);
  await throwIfError(res);
  return res.json() as Promise<ShelfEntry[]>;
}

// ── Smart shelves API (saved filter rules — ADR-019) ────────────────────────

export type SmartShelfRule = ShelfFilter;

export interface SmartShelf {
  smartShelfId: string;
  name: string;
  rule: SmartShelfRule;
  createdAt: string;
}

export interface SmartShelfWithCount extends SmartShelf {
  count: number;
}

export async function fetchSmartShelves(): Promise<SmartShelfWithCount[]> {
  const res = await authedFetch("/v1/smart-shelves");
  await throwIfError(res);
  return res.json() as Promise<SmartShelfWithCount[]>;
}

export async function createSmartShelf(name: string, rule: SmartShelfRule): Promise<SmartShelf> {
  const res = await authedFetch("/v1/smart-shelves", {
    method: "POST",
    body: JSON.stringify({ name, rule }),
  });
  await throwIfError(res);
  return res.json() as Promise<SmartShelf>;
}

export async function renameSmartShelf(smartShelfId: string, name: string): Promise<void> {
  const res = await authedFetch(`/v1/smart-shelves/${encodeURIComponent(smartShelfId)}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
  if (res.status === 204) return;
  await throwIfError(res);
}

export async function deleteSmartShelf(smartShelfId: string): Promise<void> {
  const res = await authedFetch(`/v1/smart-shelves/${encodeURIComponent(smartShelfId)}`, {
    method: "DELETE",
  });
  if (res.status === 204) return;
  await throwIfError(res);
}

// ── Account API ───────────────────────────────────────────────────────────

export async function deleteAccount(
  opts: { password: string } | { confirmation: string },
): Promise<void> {
  const res = await authedFetch("/v1/users/me", {
    method: "DELETE",
    body: JSON.stringify(opts),
  });
  if (res.status === 204) return;
  await throwIfError(res);
}

// ── Analytics API ────────────────────────────────────────────────────────────

/** Client event names the API accepts (must match the server allowlist). */
export type AnalyticsEvent =
  | "hint_shown"
  | "hint_link_clicked"
  | "hint_dismissed"
  | "scan_text_mode_activated"
  | "scan_text_mode_suggested"
  | "scan_text_mode_accepted"
  | "scan_text_success"
  | "scan_text_miss"
  | "shelf_opened"
  | "shelf_renamed"
  | "shelf_deleted";

/**
 * Record a client analytics event (ADR-016). Resolves on 204; throws ApiError
 * otherwise. Callers that want fire-and-forget behaviour should use
 * `track()` from `lib/analytics.ts` rather than calling this directly.
 */
export async function postEvent(
  name: AnalyticsEvent,
  props?: Record<string, string | number | boolean>,
): Promise<void> {
  const res = await authedFetch("/v1/events", {
    method: "POST",
    body: JSON.stringify({ name, ...(props ? { props } : {}) }),
  });
  if (res.status === 204) return;
  await throwIfError(res);
}

// ── Books API ──────────────────────────────────────────────────────────────

export async function searchBooks(q: string): Promise<BookSearchResult[]> {
  const res = await authedFetch(`/v1/books/search?q=${encodeURIComponent(q)}`);
  await throwIfError(res);
  const body = (await res.json()) as { results: BookSearchResult[] };
  return body.results;
}

export async function getBookByIsbn(isbn: string): Promise<BookSearchResult | null> {
  const res = await authedFetch(`/v1/books/isbn/${encodeURIComponent(isbn)}`);
  if (res.status === 404) return null;
  await throwIfError(res);
  return res.json() as Promise<BookSearchResult>;
}

// ── OCR scan API ───────────────────────────────────────────────────────────────

/**
 * Send a captured image to the server for ISBN OCR via AWS Rekognition.
 * Returns the ISBN-13 string, or null if no ISBN was found or the feature is
 * disabled server-side (404). Throws ApiError on non-recoverable failures.
 */
export async function scanTextIsbn(image: Blob): Promise<string | null> {
  const token = await getSession();
  const form = new FormData();
  form.append("image", image, "frame.jpg");
  // No Content-Type header — the browser sets it with the multipart boundary.
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${getRuntimeConfig().apiBaseUrl}/v1/scan/text`, {
    method: "POST",
    headers,
    body: form,
  });
  if (res.status === 404) return null; // feature disabled (OCR_SCAN_ENABLED=false)
  await throwIfError(res);
  const body = (await res.json()) as { isbn13: string | null };
  return body.isbn13 ?? null;
}
