export function isValidIsbn10(isbn: string): boolean {
  if (!/^\d{9}[\dX]$/.test(isbn)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += (10 - i) * parseInt(isbn[i]!, 10);
  }
  const last = isbn[9] === "X" ? 10 : parseInt(isbn[9]!, 10);
  sum += last;
  return sum % 11 === 0;
}

/** EAN-13 / ISBN-13 check digit computed from the first 12 digits. */
function ean13CheckDigit(core12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(core12[i]!, 10) * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidIsbn13(isbn: string): boolean {
  if (!/^\d{13}$/.test(isbn)) return false;
  return ean13CheckDigit(isbn.slice(0, 12)) === parseInt(isbn[12]!, 10);
}

export function isValidIsbn(isbn: string): boolean {
  const stripped = isbn.replace(/-/g, "");
  return isValidIsbn10(stripped) || isValidIsbn13(stripped);
}

/** Convert a (valid) ISBN-10 to its ISBN-13 form: drop the check digit, prepend 978, recompute. */
export function isbn10to13(isbn10: string): string {
  const core = "978" + isbn10.slice(0, 9);
  return core + String(ean13CheckDigit(core));
}

/**
 * Normalize an ISBN to its canonical **ISBN-13** form: strip hyphens, then convert
 * any valid ISBN-10 to ISBN-13. Callers validate with `isValidIsbn` first, so a
 * 10-digit input here is a valid ISBN-10. Canonicalizing at every write/read boundary
 * keeps the same physical book under one key — preserving duplicate detection and the
 * shared `BOOK#${isbn}` metadata cache regardless of entry path (scan, search, raw API).
 */
export function normalizeIsbn(isbn: string): string {
  const stripped = isbn.replace(/-/g, "");
  return isValidIsbn10(stripped) ? isbn10to13(stripped) : stripped;
}
