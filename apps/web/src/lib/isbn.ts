/** Returns true if the string is a valid ISBN-10 or ISBN-13. */
export function isValidIsbn(raw: string): boolean {
  const s = raw.replace(/[-\s]/g, "");
  return s.length === 10 ? validIsbn10(s) : s.length === 13 ? validIsbn13(s) : false;
}

/** Convert a (valid) ISBN-10 to its ISBN-13 form: drop the check digit, prepend 978, recompute. */
export function isbn10to13(isbn10: string): string {
  const core = "978" + isbn10.slice(0, 9);
  return core + ean13CheckDigit(core);
}

/**
 * Normalize any ISBN input (scanned or typed, ISBN-10 or ISBN-13) to a single
 * canonical **ISBN-13**, or null if it isn't a valid ISBN. ISBN-10s are converted
 * so the same physical book never lands under two keys (dedup + lookup stay aligned).
 */
export function toIsbn13(raw: string): string | null {
  const s = raw.replace(/[-\s]/g, "");
  if (!isValidIsbn(s)) return null;
  return s.length === 10 ? isbn10to13(s) : s;
}

function validIsbn10(s: string): boolean {
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const d = parseInt(s[i]!, 10);
    if (isNaN(d)) return false;
    sum += (10 - i) * d;
  }
  const last = s[9]!;
  sum += last === "X" || last === "x" ? 10 : parseInt(last, 10);
  return sum % 11 === 0;
}

function validIsbn13(s: string): boolean {
  for (let i = 0; i < 13; i++) if (isNaN(parseInt(s[i]!, 10))) return false;
  return parseInt(s[12]!, 10) === ean13CheckDigit(s.slice(0, 12));
}

/** EAN-13 / ISBN-13 check digit computed from the first 12 digits. */
function ean13CheckDigit(core12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += parseInt(core12[i]!, 10) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}
