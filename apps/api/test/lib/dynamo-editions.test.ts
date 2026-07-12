import { describe, it, expect } from "vitest";
import { editionCountsFor, type ShelfEntry, type BookMetadata } from "../../src/lib/dynamo.js";

function entry(overrides: Partial<ShelfEntry> & { isbn: string }): ShelfEntry {
  return {
    owned: true,
    want: false,
    readingStatus: null,
    tags: [],
    addedAt: "2026-01-01T00:00:00.000Z",
    notes: null,
    copies: 1,
    format: null,
    workKey: null,
    status: "owned",
    ...overrides,
  };
}

const DUNE: BookMetadata = {
  title: "Dune",
  authors: ["Frank Herbert"],
  coverUrl: null,
  publishedYear: 1965,
  description: null,
};

const NEUROMANCER: BookMetadata = {
  title: "Neuromancer",
  authors: ["William Gibson"],
  coverUrl: null,
  publishedYear: 1984,
  description: null,
};

describe("editionCountsFor (BOOKSHELF-93)", () => {
  it("counts 1 for a solo entry with no siblings", () => {
    const entries = [entry({ isbn: "a" })];
    const bookMap = { a: DUNE };
    expect(editionCountsFor(entries, bookMap)).toEqual({ a: 1 });
  });

  it("groups two editions sharing a derived work key", () => {
    const entries = [entry({ isbn: "hardcover" }), entry({ isbn: "paperback" })];
    const bookMap = { hardcover: DUNE, paperback: DUNE };
    expect(editionCountsFor(entries, bookMap)).toEqual({ hardcover: 2, paperback: 2 });
  });

  it("does not group unrelated works", () => {
    const entries = [entry({ isbn: "a" }), entry({ isbn: "b" })];
    const bookMap = { a: DUNE, b: NEUROMANCER };
    expect(editionCountsFor(entries, bookMap)).toEqual({ a: 1, b: 1 });
  });

  it("treats missing metadata as solo (never auto-groups)", () => {
    const entries = [entry({ isbn: "a" }), entry({ isbn: "b" })];
    const bookMap = { a: DUNE }; // "b" has no book metadata
    expect(editionCountsFor(entries, bookMap)).toEqual({ a: 1, b: 1 });
  });

  it("respects a workKey override — ungrouped solo sentinel excludes it from the group", () => {
    const entries = [
      entry({ isbn: "hardcover" }),
      entry({ isbn: "paperback", workKey: "solo:paperback" }),
    ];
    const bookMap = { hardcover: DUNE, paperback: DUNE };
    expect(editionCountsFor(entries, bookMap)).toEqual({ hardcover: 1, paperback: 1 });
  });

  it("groups three editions together", () => {
    const entries = [entry({ isbn: "a" }), entry({ isbn: "b" }), entry({ isbn: "c" })];
    const bookMap = { a: DUNE, b: DUNE, c: DUNE };
    expect(editionCountsFor(entries, bookMap)).toEqual({ a: 3, b: 3, c: 3 });
  });
});
