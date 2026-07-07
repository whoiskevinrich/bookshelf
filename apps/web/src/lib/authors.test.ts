import { describe, it, expect } from "vitest";
import { makeEntry, makeBook } from "../test/utils";
import { deriveAuthors, entryHasAuthor } from "./authors";

function withAuthors(isbn: string, authors: string[]) {
  return makeEntry({ isbn, book: makeBook({ authors }) });
}

describe("deriveAuthors", () => {
  it("counts distinct authors across the library, most-represented first", () => {
    const entries = [
      withAuthors("a", ["Frank Herbert"]),
      withAuthors("b", ["Frank Herbert"]),
      withAuthors("c", ["Isaac Asimov"]),
    ];
    expect(deriveAuthors(entries)).toEqual([
      { author: "Frank Herbert", count: 2 },
      { author: "Isaac Asimov", count: 1 },
    ]);
  });

  it("counts every author on co-authored books", () => {
    const entries = [
      withAuthors("a", ["Neil Gaiman", "Terry Pratchett"]),
      withAuthors("b", ["Terry Pratchett"]),
    ];
    expect(deriveAuthors(entries)).toEqual([
      { author: "Terry Pratchett", count: 2 },
      { author: "Neil Gaiman", count: 1 },
    ]);
  });

  it("breaks equal counts alphabetically", () => {
    const entries = [withAuthors("a", ["Zadie Smith"]), withAuthors("b", ["Ann Leckie"])];
    expect(deriveAuthors(entries).map((a) => a.author)).toEqual(["Ann Leckie", "Zadie Smith"]);
  });

  it("trims whitespace and ignores blank / missing metadata", () => {
    const entries = [
      withAuthors("a", ["  Ursula K. Le Guin  "]),
      withAuthors("b", ["", "   "]),
      makeEntry({ isbn: "c", book: null }),
    ];
    expect(deriveAuthors(entries)).toEqual([{ author: "Ursula K. Le Guin", count: 1 }]);
  });
});

describe("entryHasAuthor", () => {
  const book = withAuthors("a", ["Neil Gaiman", "Terry Pratchett"]);

  it("matches any author on the book (trimmed, exact)", () => {
    expect(entryHasAuthor(book, "Neil Gaiman")).toBe(true);
    expect(entryHasAuthor(book, "Terry Pratchett")).toBe(true);
  });

  it("does not match a non-author or missing metadata", () => {
    expect(entryHasAuthor(book, "Frank Herbert")).toBe(false);
    expect(entryHasAuthor(makeEntry({ book: null }), "Anyone")).toBe(false);
  });
});
