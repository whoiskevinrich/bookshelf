import { describe, it, expect } from "vitest";
import { PASSWORD_RULES, validatePassword } from "./passwordRules";

describe("PASSWORD_RULES", () => {
  it("requires at least 8 characters", () => {
    expect(PASSWORD_RULES[0]!.test("short")).toBe(false);
    expect(PASSWORD_RULES[0]!.test("longenough")).toBe(true);
  });

  it("requires an uppercase letter", () => {
    expect(PASSWORD_RULES[1]!.test("nouppercase")).toBe(false);
    expect(PASSWORD_RULES[1]!.test("HasUpper")).toBe(true);
  });

  it("requires a lowercase letter", () => {
    expect(PASSWORD_RULES[2]!.test("NOLOWER")).toBe(false);
    expect(PASSWORD_RULES[2]!.test("HasLower")).toBe(true);
  });

  it("requires a digit", () => {
    expect(PASSWORD_RULES[3]!.test("NoDigits")).toBe(false);
    expect(PASSWORD_RULES[3]!.test("HasDigit1")).toBe(true);
  });
});

describe("validatePassword", () => {
  it("returns null for a valid password", () => {
    expect(validatePassword("ValidPass1")).toBeNull();
  });

  it("returns an error message for a failing rule", () => {
    expect(validatePassword("short")).toMatch(/at least 8 characters/i);
    expect(validatePassword("nouppercase1")).toMatch(/uppercase/i);
    expect(validatePassword("NOLOWER1")).toMatch(/lowercase/i);
    expect(validatePassword("NoDigits")).toMatch(/number/i);
  });
});
