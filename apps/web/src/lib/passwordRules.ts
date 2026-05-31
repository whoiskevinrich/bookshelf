export interface PasswordRule {
  test: (password: string) => boolean;
  label: string;
}

export const PASSWORD_RULES: PasswordRule[] = [
  { test: (p) => p.length >= 8, label: "At least 8 characters" },
  { test: (p) => /[A-Z]/.test(p), label: "One uppercase letter" },
  { test: (p) => /[a-z]/.test(p), label: "One lowercase letter" },
  { test: (p) => /[0-9]/.test(p), label: "One number" },
];

/** Returns the first failing rule message, or null if all pass. */
export function validatePassword(password: string): string | null {
  const failed = PASSWORD_RULES.find((r) => !r.test(password));
  return failed ? `Password must include: ${failed.label.toLowerCase()}.` : null;
}
