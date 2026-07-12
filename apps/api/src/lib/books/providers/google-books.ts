import type { BookProvider, BookSearchResult } from "../types.js";
import type { EditionFormat } from "../../works.js";

const BASE_URL = "https://www.googleapis.com/books/v1/volumes";

// Google Books occasionally returns transient errors under load (BOOKSHELF-95). Retry those;
// a 4xx like a bad key or malformed query never resolves on retry, so fail fast instead.
const MAX_ATTEMPTS = 3;
// Delay doubles each retry (300ms, 600ms) — worst case ~900ms across 3 attempts, well under
// the E2E suite's 15s per-assertion timeout (apps/web/e2e/helpers.ts).
const RETRY_BASE_DELAY_MS = 300;
const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface GoogleBooksVolume {
  id: string;
  volumeInfo: {
    title?: string;
    authors?: string[];
    publishedDate?: string;
    description?: string;
    imageLinks?: {
      thumbnail?: string;
      smallThumbnail?: string;
    };
    industryIdentifiers?: Array<{
      type: string;
      identifier: string;
    }>;
  };
  saleInfo?: {
    isEbook?: boolean;
  };
}

interface GoogleBooksResponse {
  totalItems: number;
  items?: GoogleBooksVolume[];
}

function extractIsbn(volume: GoogleBooksVolume): string {
  const ids = volume.volumeInfo.industryIdentifiers ?? [];
  const isbn13 = ids.find((id) => id.type === "ISBN_13");
  const isbn10 = ids.find((id) => id.type === "ISBN_10");
  return isbn13?.identifier ?? isbn10?.identifier ?? volume.id;
}

function extractYear(publishedDate?: string): number | null {
  if (!publishedDate) return null;
  const year = parseInt(publishedDate.slice(0, 4), 10);
  return isNaN(year) ? null : year;
}

function extractCoverUrl(volume: GoogleBooksVolume): string | null {
  const links = volume.volumeInfo.imageLinks;
  if (!links) return null;
  // Prefer higher-res thumbnail; strip zoom param noise for a cleaner URL
  const raw = links.thumbnail ?? links.smallThumbnail ?? null;
  if (!raw) return null;
  // Force HTTPS
  return raw.replace(/^http:\/\//, "https://");
}

/**
 * Best-effort edition format hint from Google Books signals (BOOKSHELF-92). Only
 * fires for signals the API expresses unambiguously: `saleInfo.isEbook` is a
 * structured field, and "audiobook" is inferable from explicit wording Google
 * Books includes in the title for audio editions. There's no structured signal
 * for hardcover vs. paperback, so binding type is never guessed — silence over a
 * wrong label. Never overrides a user-set format; only consulted on a fresh add.
 */
function extractFormatHint(volume: GoogleBooksVolume): EditionFormat | null {
  const title = volume.volumeInfo.title ?? "";
  if (/audiobook|audio\s*book|unabridged/i.test(title)) return "audiobook";
  if (volume.saleInfo?.isEbook) return "ebook";
  return null;
}

function toSearchResult(volume: GoogleBooksVolume): BookSearchResult {
  return {
    isbn: extractIsbn(volume),
    title: volume.volumeInfo.title ?? "Unknown Title",
    authors: volume.volumeInfo.authors ?? [],
    coverUrl: extractCoverUrl(volume),
    publishedYear: extractYear(volume.volumeInfo.publishedDate),
    description: volume.volumeInfo.description ?? null,
    formatHint: extractFormatHint(volume),
  };
}

async function fetchVolumes(
  query: string,
  apiKey: string,
  maxResults = 10,
): Promise<BookSearchResult[]> {
  const url = new URL(BASE_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("maxResults", String(maxResults));
  url.searchParams.set("printType", "books");
  if (apiKey) url.searchParams.set("key", apiKey);

  let res: Response;
  for (let attempt = 1; ; attempt++) {
    res = await fetch(url.toString());
    if (res.ok || !RETRYABLE_STATUS_CODES.has(res.status) || attempt === MAX_ATTEMPTS) {
      break;
    }
    await sleep(RETRY_BASE_DELAY_MS * attempt);
  }
  if (!res.ok) {
    throw new Error(`Google Books API error: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as GoogleBooksResponse;
  return (data.items ?? []).map(toSearchResult);
}

export function createGoogleBooksProvider(apiKey: string): BookProvider {
  return {
    name: "google-books",

    async search(query: string): Promise<BookSearchResult[]> {
      return fetchVolumes(query, apiKey);
    },

    async getByIsbn(isbn: string): Promise<BookSearchResult | null> {
      const results = await fetchVolumes(`isbn:${isbn}`, apiKey, 1);
      const result = results[0];
      if (!result) return null;
      // Some Google Books records omit industryIdentifiers, in which case
      // extractIsbn falls back to the opaque volume id — but we already know the
      // real ISBN (this is the isbn:${isbn} query that found the record), so use
      // it directly rather than trusting a possibly-missing extracted value.
      return { ...result, isbn };
    },

    async getByAsin(asin: string): Promise<BookSearchResult | null> {
      // ASINs for books often match ISBN-10; try ISBN lookup first
      const byIsbn = await fetchVolumes(`isbn:${asin}`, apiKey, 1);
      if (byIsbn[0]) return byIsbn[0];
      // Fall back to keyword search
      const byKeyword = await fetchVolumes(asin, apiKey, 1);
      return byKeyword[0] ?? null;
    },
  };
}
