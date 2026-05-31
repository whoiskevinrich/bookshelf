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

export function isValidIsbn13(isbn: string): boolean {
  if (!/^\d{13}$/.test(isbn)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(isbn[i]!, 10) * (i % 2 === 0 ? 1 : 3);
  }
  const check = (10 - (sum % 10)) % 10;
  return check === parseInt(isbn[12]!, 10);
}

export function isValidIsbn(isbn: string): boolean {
  const stripped = isbn.replace(/-/g, "");
  return isValidIsbn10(stripped) || isValidIsbn13(stripped);
}

export function normalizeIsbn(isbn: string): string {
  return isbn.replace(/-/g, "");
}
