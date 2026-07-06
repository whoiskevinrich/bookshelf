import { describe, it, expect } from "vitest";
import { makeEntry, makeBook } from "../test/utils";
import { sortEntries, parseSortKey, sortLabel, DEFAULT_SORT, type SortKey } from "./sort";

/** Build an entry with just the fields sorting cares about. */
function entry(opts: {
  isbn: string;
  title?: string;
  author?: string;
  year?: number | null;
  addedAt?: string;
  book?: null;
}) {
  return makeEntry({
    isbn: opts.isbn,
    addedAt: opts.addedAt ?? "2026-01-01T00:00:00.000Z",
    book:
      opts.book === null
        ? null
        : makeBook({
            title: opts.title ?? "Untitled",
            authors: opts.author ? [opts.author] : [],
            publishedYear: opts.year === undefined ? null : opts.year,
          }),
  });
}

function isbns(entries: ReturnType<typeof entry>[], key: SortKey): string[] {
  return sortEntries(entries, key).map((e) => e.isbn);
}

describe("parseSortKey", () => {
  it("accepts known keys", () => {
    expect(parseSortKey("title-asc")).toBe("title-asc");
    expect(parseSortKey("added-desc")).toBe("added-desc");
  });

  it("rejects unknown or empty values", () => {
    expect(parseSortKey("bogus")).toBeNull();
    expect(parseSortKey("")).toBeNull();
    expect(parseSortKey(null)).toBeNull();
    expect(parseSortKey(undefined)).toBeNull();
  });
});

describe("sortLabel", () => {
  it("maps the default key to its label", () => {
    expect(sortLabel(DEFAULT_SORT)).toBe("Recently added");
  });
});

describe("sortEntries", () => {
  it("does not mutate the input array", () => {
    const list = [entry({ isbn: "b", title: "B" }), entry({ isbn: "a", title: "A" })];
    const before = list.map((e) => e.isbn);
    sortEntries(list, "title-asc");
    expect(list.map((e) => e.isbn)).toEqual(before);
  });

  it("sorts by date added, newest first (default)", () => {
    const list = [
      entry({ isbn: "old", addedAt: "2026-01-01T00:00:00.000Z" }),
      entry({ isbn: "new", addedAt: "2026-06-01T00:00:00.000Z" }),
      entry({ isbn: "mid", addedAt: "2026-03-01T00:00:00.000Z" }),
    ];
    expect(isbns(list, "added-desc")).toEqual(["new", "mid", "old"]);
    expect(isbns(list, "added-asc")).toEqual(["old", "mid", "new"]);
  });

  it("sorts by title A–Z, case- and diacritic-tolerant", () => {
    const list = [
      entry({ isbn: "z", title: "Zebra" }),
      entry({ isbn: "e", title: "émigré" }),
      entry({ isbn: "a", title: "apple" }),
    ];
    expect(isbns(list, "title-asc")).toEqual(["a", "e", "z"]);
  });

  it("sorts by first author A–Z, using the name as displayed (no surname parsing)", () => {
    const list = [
      entry({ isbn: "herbert", author: "Frank Herbert" }),
      entry({ isbn: "asimov", author: "Isaac Asimov" }),
      entry({ isbn: "atwood", author: "Margaret Atwood" }),
    ];
    expect(isbns(list, "author-asc")).toEqual(["herbert", "asimov", "atwood"]);
  });

  it("sorts by release year in both directions", () => {
    const list = [
      entry({ isbn: "1984", year: 1949 }),
      entry({ isbn: "dune", year: 1965 }),
      entry({ isbn: "neuromancer", year: 1984 }),
    ];
    expect(isbns(list, "release-desc")).toEqual(["neuromancer", "dune", "1984"]);
    expect(isbns(list, "release-asc")).toEqual(["1984", "dune", "neuromancer"]);
  });

  it("pushes missing release years to the end in both directions", () => {
    const list = [
      entry({ isbn: "known", year: 2000 }),
      entry({ isbn: "unknown", year: null }),
      entry({ isbn: "older", year: 1990 }),
    ];
    expect(isbns(list, "release-desc")).toEqual(["known", "older", "unknown"]);
    expect(isbns(list, "release-asc")).toEqual(["older", "known", "unknown"]);
  });

  it("pushes entries with missing metadata to the end when sorting by title", () => {
    const list = [
      entry({ isbn: "meta", title: "Middlemarch" }),
      entry({ isbn: "nometa", book: null }),
    ];
    expect(isbns(list, "title-asc")).toEqual(["meta", "nometa"]);
  });

  it("breaks ties by title so equal keys stay deterministic", () => {
    const list = [
      entry({ isbn: "b", author: "Same Author", title: "Beta" }),
      entry({ isbn: "a", author: "Same Author", title: "Alpha" }),
    ];
    expect(isbns(list, "author-asc")).toEqual(["a", "b"]);
  });
});
