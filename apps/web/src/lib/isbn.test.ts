import { describe, it, expect } from "vitest";
import { isValidIsbn, isbn10to13, toIsbn13 } from "./isbn";

describe("isValidIsbn", () => {
  it("accepts valid ISBN-13 and ISBN-10 (incl. trailing X)", () => {
    expect(isValidIsbn("9780306406157")).toBe(true);
    expect(isValidIsbn("0553381350")).toBe(true);
    expect(isValidIsbn("0-8044-2957-X")).toBe(true);
  });

  it("rejects bad checksums and wrong lengths", () => {
    expect(isValidIsbn("9780306406158")).toBe(false);
    expect(isValidIsbn("0553381351")).toBe(false);
    expect(isValidIsbn("123456789012")).toBe(false); // 12-digit UPC
  });
});

describe("isbn10to13", () => {
  it("converts ISBN-10 to ISBN-13 with a recomputed check digit", () => {
    expect(isbn10to13("0306406152")).toBe("9780306406157");
    expect(isbn10to13("0553381350")).toBe("9780553381351"); // "The Right Stuff"
    expect(isbn10to13("080442957X")).toBe("9780804429573"); // X check digit
  });
});

describe("toIsbn13", () => {
  it("passes a valid ISBN-13 through unchanged", () => {
    expect(toIsbn13("9780306406157")).toBe("9780306406157");
  });

  it("normalizes a valid ISBN-10 (with separators) to ISBN-13", () => {
    expect(toIsbn13("0-553-38135-0")).toBe("9780553381351");
    expect(toIsbn13("0553381350")).toBe("9780553381351");
  });

  it("returns null for invalid or non-ISBN input (so it never reaches a lookup)", () => {
    expect(toIsbn13("9780306406158")).toBeNull(); // bad ISBN-13 checksum
    expect(toIsbn13("0553381351")).toBeNull(); // bad ISBN-10 checksum
    expect(toIsbn13("036000291452")).toBeNull(); // 12-digit UPC-A, not an ISBN
    expect(toIsbn13("")).toBeNull();
  });
});
