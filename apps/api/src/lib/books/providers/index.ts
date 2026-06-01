import { SSMProvider } from "@aws-lambda-powertools/parameters/ssm";
import type { BookProvider } from "../types.js";
import { createGoogleBooksProvider } from "./google-books.js";

const PROVIDERS: Record<string, (apiKey: string) => BookProvider> = {
  "google-books": createGoogleBooksProvider,
};

const ssmProvider = new SSMProvider();

// 7 days in seconds — the Google Books API key rarely rotates
const API_KEY_TTL_SECONDS = 7 * 24 * 60 * 60;

export async function getActiveProvider(): Promise<BookProvider> {
  const name = process.env["BOOK_PROVIDER"] ?? "google-books";
  const factory = PROVIDERS[name];
  if (!factory) {
    throw new Error(`Unknown book provider: ${name}`);
  }

  const ssmName = process.env["GOOGLE_BOOKS_API_KEY_SSM_NAME"];
  const apiKey = ssmName
    ? ((await ssmProvider.get(ssmName, {
        maxAge: API_KEY_TTL_SECONDS,
        decrypt: true,
      })) ?? "")
    : (process.env["GOOGLE_BOOKS_API_KEY"] ?? "");

  return factory(apiKey);
}
