import { describe, it, expect } from "vitest";
import { makeEntry, makeBook } from "../test/utils";
import { normalizeForSearch, entryMatchesQuery } from "./search";

describe("normalizeForSearch", () => {
  it("lowercases and trims", () => {
    expect(normalizeForSearch("  The Hobbit  ")).toBe("the hobbit");
  });

  it("strips diacritics so accented and plain forms fold together", () => {
    expect(normalizeForSearch("Márquez")).toBe("marquez");
    expect(normalizeForSearch("Émile Zola")).toBe("emile zola");
    expect(normalizeForSearch("Jokübaĩtis")).toBe("jokubaitis");
  });
});

describe("entryMatchesQuery", () => {
  const hobbit = makeEntry({
    book: makeBook({ title: "The Hobbit", authors: ["J.R.R. Tolkien"] }),
  });

  it("matches on title, case-insensitively", () => {
    expect(entryMatchesQuery(hobbit, "hobbit")).toBe(true);
    expect(entryMatchesQuery(hobbit, "HOBB")).toBe(true);
  });

  it("matches on author name", () => {
    expect(entryMatchesQuery(hobbit, "tolkien")).toBe(true);
  });

  it("is diacritic-insensitive on both query and content", () => {
    const marquez = makeEntry({
      book: makeBook({ title: "Cien años de soledad", authors: ["Gabriel García Márquez"] }),
    });
    expect(entryMatchesQuery(marquez, "marquez")).toBe(true);
    expect(entryMatchesQuery(marquez, "anos")).toBe(true);
  });

  it("requires every whitespace-separated token, order-independent", () => {
    expect(entryMatchesQuery(hobbit, "tolkien hobbit")).toBe(true);
    expect(entryMatchesQuery(hobbit, "hobbit dune")).toBe(false);
  });

  it("treats an empty or whitespace query as matching everything", () => {
    expect(entryMatchesQuery(hobbit, "")).toBe(true);
    expect(entryMatchesQuery(hobbit, "   ")).toBe(true);
  });

  it("does not match when there is no book metadata", () => {
    expect(entryMatchesQuery(makeEntry({ book: null }), "hobbit")).toBe(false);
  });

  it("does not match unrelated text", () => {
    expect(entryMatchesQuery(hobbit, "gatsby")).toBe(false);
  });
});
