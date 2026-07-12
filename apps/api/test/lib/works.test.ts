import { describe, it, expect } from "vitest";
import { deriveWorkKey, isValidFormat, soloWorkKey, WORK_KEY_MAX } from "../../src/lib/works.js";

describe("deriveWorkKey", () => {
  it("derives title|author from metadata", () => {
    expect(deriveWorkKey({ title: "Dune", authors: ["Frank Herbert"] })).toBe("dune|frank herbert");
  });

  it("groups two editions of the same work under the same key", () => {
    const hardcover = deriveWorkKey({ title: "Dune", authors: ["Frank Herbert"] });
    const paperback = deriveWorkKey({ title: "DUNE", authors: ["Frank  Herbert"] });
    expect(hardcover).toBe(paperback);
  });

  it("is case-insensitive and collapses whitespace", () => {
    expect(deriveWorkKey({ title: "  The   Hobbit ", authors: ["  J.R.R. Tolkien  "] })).toBe(
      "hobbit|jrr tolkien",
    );
  });

  it("strips a single leading article", () => {
    expect(deriveWorkKey({ title: "The Great Gatsby", authors: ["F. Scott Fitzgerald"] })).toBe(
      "great gatsby|f scott fitzgerald",
    );
    expect(deriveWorkKey({ title: "A Wrinkle in Time", authors: ["L'Engle"] })).toBe(
      "wrinkle in time|lengle",
    );
    expect(deriveWorkKey({ title: "An Ember in the Ashes", authors: ["Tahir"] })).toBe(
      "ember in the ashes|tahir",
    );
  });

  it("drops a trailing ': subtitle' so a subtitled edition groups with the bare title", () => {
    const bare = deriveWorkKey({ title: "Dune", authors: ["Frank Herbert"] });
    const subtitled = deriveWorkKey({ title: "Dune: Book One", authors: ["Frank Herbert"] });
    expect(subtitled).toBe(bare);
    expect(subtitled).toBe("dune|frank herbert");
  });

  it("keeps genuinely different main titles distinct (Foundation vs Foundation and Empire)", () => {
    const a = deriveWorkKey({ title: "Foundation", authors: ["Isaac Asimov"] });
    const b = deriveWorkKey({ title: "Foundation and Empire", authors: ["Isaac Asimov"] });
    expect(a).not.toBe(b);
  });

  it("strips punctuation from the author but keeps letters/numbers", () => {
    expect(deriveWorkKey({ title: "It", authors: ["Stephen King, Jr."] })).toBe(
      "it|stephen king jr",
    );
  });

  it("uses only the primary author (authors[0])", () => {
    const solo = deriveWorkKey({ title: "Good Omens", authors: ["Terry Pratchett"] });
    const duo = deriveWorkKey({
      title: "Good Omens",
      authors: ["Terry Pratchett", "Neil Gaiman"],
    });
    expect(duo).toBe(solo);
  });

  it("returns null when the title is missing or blank (never auto-group)", () => {
    expect(deriveWorkKey({ title: "", authors: ["Frank Herbert"] })).toBeNull();
    expect(deriveWorkKey({ title: "   ", authors: ["Frank Herbert"] })).toBeNull();
    expect(deriveWorkKey({ authors: ["Frank Herbert"] })).toBeNull();
    expect(deriveWorkKey({ title: null, authors: ["Frank Herbert"] })).toBeNull();
  });

  it("returns null when the author is missing or blank (never auto-group)", () => {
    expect(deriveWorkKey({ title: "Dune", authors: [] })).toBeNull();
    expect(deriveWorkKey({ title: "Dune", authors: [""] })).toBeNull();
    expect(deriveWorkKey({ title: "Dune" })).toBeNull();
    expect(deriveWorkKey({ title: "Dune", authors: null })).toBeNull();
  });

  it("returns null for null metadata", () => {
    expect(deriveWorkKey(null)).toBeNull();
  });

  it("treats a leading colon as text, not a subtitle separator (keeps the title)", () => {
    // The subtitle drop only fires for a colon *after* a main title (index > 0);
    // a title starting with ':' has no main title to keep, so the text is retained.
    expect(deriveWorkKey({ title: ": subtitle only", authors: ["Someone"] })).toBe(
      ": subtitle only|someone",
    );
  });
});

describe("isValidFormat", () => {
  it("accepts the four edition formats", () => {
    for (const f of ["hardcover", "paperback", "ebook", "audiobook"]) {
      expect(isValidFormat(f)).toBe(true);
    }
  });

  it("rejects unknown values, null, and non-strings", () => {
    expect(isValidFormat("kindle")).toBe(false);
    expect(isValidFormat("")).toBe(false);
    expect(isValidFormat(null)).toBe(false);
    expect(isValidFormat(undefined)).toBe(false);
    expect(isValidFormat(42)).toBe(false);
  });
});

describe("soloWorkKey", () => {
  it("produces a self-only key that can never collide with a derived key", () => {
    const solo = soloWorkKey("9780441013593");
    expect(solo).toBe("solo:9780441013593");
    // Derived keys always contain a '|'; the solo sentinel never does.
    expect(solo).not.toContain("|");
    expect(solo.length).toBeLessThanOrEqual(WORK_KEY_MAX);
  });
});
