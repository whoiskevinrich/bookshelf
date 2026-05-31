import { describe, it, expect } from "vitest";
import { isValidIsbn10, isValidIsbn13, isValidIsbn, normalizeIsbn } from "../../src/lib/isbn.js";

describe("isValidIsbn10", () => {
  it("accepts a valid ISBN-10", () => {
    expect(isValidIsbn10("0306406152")).toBe(true);
  });

  it("accepts a valid ISBN-10 with X check digit", () => {
    // 097522980X is a known-valid ISBN-10 with X check digit
    expect(isValidIsbn10("097522980X")).toBe(true);
  });

  it("rejects an ISBN-10 with wrong check digit", () => {
    expect(isValidIsbn10("0306406153")).toBe(false);
  });

  it("rejects a non-numeric string", () => {
    expect(isValidIsbn10("030640615A")).toBe(false);
  });

  it("rejects wrong length", () => {
    expect(isValidIsbn10("030640615")).toBe(false);
  });
});

describe("isValidIsbn13", () => {
  it("accepts a valid ISBN-13", () => {
    expect(isValidIsbn13("9780441013593")).toBe(true);
  });

  it("rejects an ISBN-13 with wrong check digit", () => {
    expect(isValidIsbn13("9780441013594")).toBe(false);
  });

  it("rejects wrong length", () => {
    expect(isValidIsbn13("978044101359")).toBe(false);
  });
});

describe("isValidIsbn", () => {
  it("accepts a hyphenated ISBN-13", () => {
    expect(isValidIsbn("978-0-441-01359-3")).toBe(true);
  });

  it("accepts a plain ISBN-10", () => {
    expect(isValidIsbn("0306406152")).toBe(true);
  });

  it("rejects garbage input", () => {
    expect(isValidIsbn("notanisbn")).toBe(false);
  });
});

describe("normalizeIsbn", () => {
  it("strips hyphens", () => {
    expect(normalizeIsbn("978-0-441-01359-3")).toBe("9780441013593");
  });
});
