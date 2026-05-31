import type { BookProvider, BookSearchResult } from "../types.js";

const BASE_URL = "https://www.googleapis.com/books/v1/volumes";

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

function toSearchResult(volume: GoogleBooksVolume): BookSearchResult {
  return {
    isbn: extractIsbn(volume),
    title: volume.volumeInfo.title ?? "Unknown Title",
    authors: volume.volumeInfo.authors ?? [],
    coverUrl: extractCoverUrl(volume),
    publishedYear: extractYear(volume.volumeInfo.publishedDate),
    description: volume.volumeInfo.description ?? null,
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

  const res = await fetch(url.toString());
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
      return results[0] ?? null;
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
