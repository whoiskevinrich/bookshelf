/** Returns true if the string is a valid ISBN-10 or ISBN-13. */
export function isValidIsbn(raw: string): boolean {
  const s = raw.replace(/[-\s]/g, "");
  return s.length === 10 ? validIsbn10(s) : s.length === 13 ? validIsbn13(s) : false;
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
  let sum = 0;
  for (let i = 0; i < 13; i++) {
    const d = parseInt(s[i]!, 10);
    if (isNaN(d)) return false;
    sum += d * (i % 2 === 0 ? 1 : 3);
  }
  return sum % 10 === 0;
}
