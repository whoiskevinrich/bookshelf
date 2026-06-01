/**
 * Validates that all demo shelf ISBNs resolve to a cover image in Google Books.
 *
 * Usage:
 *   GOOGLE_BOOKS_API_KEY=<key> pnpm --filter @bookshelf/api validate:covers
 *   # API key is optional — quota limits apply without one
 */

import { createGoogleBooksProvider } from "../src/lib/books/providers/google-books.js";

const API_KEY = process.env["GOOGLE_BOOKS_API_KEY"] ?? "";
const provider = createGoogleBooksProvider(API_KEY);

const DEMO_ISBNS: Record<string, string> = {
  "9780441013593": "Dune",
  "9780441569595": "Neuromancer",
  "9780441478125": "The Left Hand of Darkness",
  "9780593135204": "Project Hail Mary",
  "9780756404741": "The Name of the Wind",
  "9780765326355": "The Way of Kings",
  "9780316229296": "The Fifth Season",
  "9781447273127": "Children of Time",
  "9780812515282": "A Fire Upon the Deep",
  "9781635575637": "Piranesi",
};

const results = await Promise.allSettled(
  Object.entries(DEMO_ISBNS).map(async ([isbn, title]) => {
    const book = await provider.getByIsbn(isbn);
    return { isbn, title, coverUrl: book?.coverUrl ?? null };
  }),
);

let pass = 0;
let fail = 0;

const isbnEntries = Object.entries(DEMO_ISBNS);

for (const [i, result] of results.entries()) {
  if (result.status === "rejected") {
    const [isbn, title] = isbnEntries[i]!;
    console.log(`  ✗ ${isbn}  ${title}  — error: ${(result.reason as Error).message}`);
    fail++;
  } else if (result.value.coverUrl) {
    console.log(`  ✓ ${result.value.isbn}  ${result.value.title}`);
    pass++;
  } else {
    console.log(`  ✗ ${result.value.isbn}  ${result.value.title}  — no cover`);
    fail++;
  }
}

console.log(`\n${pass}/${pass + fail} ISBNs have Google Books cover images`);
if (fail > 0) process.exit(1);
