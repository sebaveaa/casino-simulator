import { describe, expect, it } from "vitest";
import {
  amountSchema,
  formatCredits,
  MAX_MONEY,
  parseAmount,
  positiveAmountSchema,
  signedAmountSchema,
  toAmount,
} from "./money";

const ok = (schema: { safeParse(v: unknown): { success: boolean } }, v: unknown) =>
  schema.safeParse(v).success;

describe("amountSchema", () => {
  it("accepts zero, plain integers and the maximum", () => {
    for (const v of ["0", "7", "1000", MAX_MONEY.toString()])
      expect(ok(amountSchema, v)).toBe(true);
  });

  it("rejects leading zeros, signs, decimals, blanks and non-strings", () => {
    for (const v of ["00", "01", "-0", "-1", "+1", "1.5", "", " 1", "1e3", "abc", 5, 5n, null]) {
      expect(ok(amountSchema, v)).toBe(false);
    }
  });

  it("rejects MAX_MONEY + 1", () => {
    expect(ok(amountSchema, (MAX_MONEY + 1n).toString())).toBe(false);
  });
});

describe("positiveAmountSchema", () => {
  it("accepts positive amounts and rejects zero", () => {
    expect(ok(positiveAmountSchema, "1")).toBe(true);
    expect(ok(positiveAmountSchema, "0")).toBe(false);
  });
});

describe("signedAmountSchema", () => {
  it("accepts signed values within bounds", () => {
    for (const v of ["0", "5", "-5", MAX_MONEY.toString(), (-MAX_MONEY).toString()]) {
      expect(ok(signedAmountSchema, v)).toBe(true);
    }
  });

  it("rejects negative zero, leading zeros, bad signs and out-of-range values", () => {
    const tooLow = (-MAX_MONEY - 1n).toString();
    const tooHigh = (MAX_MONEY + 1n).toString();
    for (const v of ["-0", "-05", "+5", "--5", "-", tooLow, tooHigh]) {
      expect(ok(signedAmountSchema, v)).toBe(false);
    }
  });
});

describe("toAmount / parseAmount", () => {
  it("round-trips values including the bounds", () => {
    for (const v of [0n, 1n, -1n, 123456n, MAX_MONEY, -MAX_MONEY]) {
      expect(parseAmount(toAmount(v))).toBe(v);
    }
  });

  it("toAmount throws RangeError outside ±MAX_MONEY", () => {
    expect(() => toAmount(MAX_MONEY + 1n)).toThrow(RangeError);
    expect(() => toAmount(-MAX_MONEY - 1n)).toThrow(RangeError);
  });

  it("parseAmount throws on invalid input", () => {
    expect(() => parseAmount("1.5")).toThrow();
    expect(() => parseAmount("-0")).toThrow();
    expect(() => parseAmount((MAX_MONEY + 1n).toString())).toThrow();
  });
});

describe("formatCredits", () => {
  it("formats sign, separators and two decimals", () => {
    expect(formatCredits(0n)).toBe("0.00");
    expect(formatCredits(5n)).toBe("0.05");
    expect(formatCredits(-5n)).toBe("-0.05");
    expect(formatCredits(100n)).toBe("1.00");
    expect(formatCredits(123456n)).toBe("1,234.56");
    expect(formatCredits(-123456789n)).toBe("-1,234,567.89");
  });

  it("is exact beyond Number precision", () => {
    expect(formatCredits(MAX_MONEY)).toBe("92,233,720,368,547,758.07");
  });
});
