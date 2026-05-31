export interface BookSearchResult {
  isbn: string;
  title: string;
  authors: string[];
  coverUrl: string | null;
  publishedYear: number | null;
  description: string | null;
}

export interface BookProvider {
  name: string;
  search(query: string): Promise<BookSearchResult[]>;
  getByIsbn(isbn: string): Promise<BookSearchResult | null>;
  getByAsin(asin: string): Promise<BookSearchResult | null>;
}
