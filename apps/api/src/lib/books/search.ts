import { getActiveProvider } from "./providers/index.js";
import type { BookSearchResult } from "./types.js";

export async function searchBooks(query: string): Promise<BookSearchResult[]> {
  const provider = await getActiveProvider();
  return provider.search(query);
}

export async function getBookByIsbn(isbn: string): Promise<BookSearchResult | null> {
  const provider = await getActiveProvider();
  return provider.getByIsbn(isbn);
}

export async function getBookByAsin(asin: string): Promise<BookSearchResult | null> {
  const provider = await getActiveProvider();
  return provider.getByAsin(asin);
}
