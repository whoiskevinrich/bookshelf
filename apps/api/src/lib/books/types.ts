import type { EditionFormat } from "../works.js";

export interface BookSearchResult {
  isbn: string;
  title: string;
  authors: string[];
  coverUrl: string | null;
  publishedYear: number | null;
  description: string | null;
  /**
   * Best-effort edition format hint from provider signals (BOOKSHELF-92), or `null`/
   * absent when the provider gives no unambiguous signal. Internal to the add flow —
   * never a replacement for the user-set `format` on the shelf entry.
   */
  formatHint?: EditionFormat | null;
}

export interface BookProvider {
  name: string;
  search(query: string): Promise<BookSearchResult[]>;
  getByIsbn(isbn: string): Promise<BookSearchResult | null>;
  getByAsin(asin: string): Promise<BookSearchResult | null>;
}
