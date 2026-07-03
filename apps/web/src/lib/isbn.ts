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

/**
 * Normalize a scanned barcode value to a canonical **ISBN-13**, tolerating a read
 * that merged the EAN-13 book code with its EAN-2/EAN-5 price add-on into one
 * digit run. Book barcodes often carry a smaller supplemental barcode (price /
 * currency); most decoders drop it, but some native `BarcodeDetector`
 * implementations concatenate it, yielding 15 (EAN-13 + EAN-2) or 18 (EAN-13 +
 * EAN-5) digits instead of 13.
 *
 * If `raw` already normalizes cleanly (`toIsbn13`) that wins. Otherwise, when the
 * digits are a 978/979 EAN-13 followed by a 2- or 5-digit add-on, the leading 13
 * are checksum-validated and returned. The 978/979 prefix + checksum gate makes a
 * false positive astronomically unlikely, so this is safe by construction. Returns
 * null when neither holds — the caller keeps scanning.
 */
export function extractIsbn13(raw: string): string | null {
  const direct = toIsbn13(raw);
  if (direct) return direct;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 15 || digits.length === 18) {
    const core = digits.slice(0, 13);
    if (/^97[89]/.test(core)) return toIsbn13(core);
  }
  return null;
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
