import { describe, it, expect } from "vitest";
import { isValidIsbn, isbn10to13, toIsbn13, extractIsbn13 } from "./isbn";

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

describe("extractIsbn13", () => {
  it("passes clean ISBN-13 and ISBN-10 reads through (same as toIsbn13)", () => {
    expect(extractIsbn13("9780306406157")).toBe("9780306406157");
    expect(extractIsbn13("0553381350")).toBe("9780553381351");
  });

  it("recovers the ISBN-13 from a read merged with an EAN-5 price add-on", () => {
    // 9780306406157 + 51299 (a $12.99 EAN-5 supplement) = 18 digits
    expect(extractIsbn13("978030640615751299")).toBe("9780306406157");
  });

  it("recovers the ISBN-13 from a read merged with an EAN-2 add-on", () => {
    // 9780306406157 + 05 (an EAN-2 supplement) = 15 digits
    expect(extractIsbn13("978030640615705")).toBe("9780306406157");
  });

  it("rejects a merged read whose leading 13 fail the EAN-13 checksum", () => {
    expect(extractIsbn13("978030640615851299")).toBeNull(); // bad check digit
  });

  it("rejects a merged read that isn't a 978/979 Bookland EAN", () => {
    // Valid-length (18) but a non-book EAN-13 prefix — don't salvage it.
    expect(extractIsbn13("400638133393112345")).toBeNull();
  });

  it("returns null for garbage and wrong-length digit runs", () => {
    expect(extractIsbn13("")).toBeNull();
    expect(extractIsbn13("97803064061")).toBeNull(); // 11 digits
    expect(extractIsbn13("9780306406157123")).toBeNull(); // 16 digits (no valid add-on length)
  });
});
