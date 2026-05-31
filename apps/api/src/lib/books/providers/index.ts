import type { BookProvider } from "../types.js";
import { createGoogleBooksProvider } from "./google-books.js";

const PROVIDERS: Record<string, (apiKey: string) => BookProvider> = {
  "google-books": createGoogleBooksProvider,
};

let _provider: BookProvider | null = null;

export function getActiveProvider(): BookProvider {
  if (!_provider) {
    const name = process.env["BOOK_PROVIDER"] ?? "google-books";
    const factory = PROVIDERS[name];
    if (!factory) {
      throw new Error(`Unknown book provider: ${name}`);
    }
    const apiKey = process.env["GOOGLE_BOOKS_API_KEY"] ?? "";
    _provider = factory(apiKey);
  }
  return _provider;
}
