import { z } from "zod";

/** An amount in minor units. Always an integer, never a float (README §3.4). */
export type Money = bigint;

/** Display only: 1 credit = 100 minor units. */
export const MINOR_UNITS_PER_CREDIT = 100n;

/** Largest value of a PostgreSQL `bigint`. */
export const MAX_MONEY: Money = 9223372036854775807n;

const unsignedPattern = /^(0|[1-9]\d*)$/;
const signedPattern = /^(0|-?[1-9]\d*)$/;

/** Longest valid amount string: the 19 digits of `MAX_MONEY` plus a sign. */
const MAX_AMOUNT_LENGTH = 20;

// Zod 4 runs refinements even after a failed length or regex check, so this guard
// skips non-numeric and over-long input before `BigInt` can spend time on it.
function absWithinBounds(value: string): boolean {
  if (value.length > MAX_AMOUNT_LENGTH) return true;
  if (!signedPattern.test(value)) return true;
  const abs = value.startsWith("-") ? value.slice(1) : value;
  return BigInt(abs) <= MAX_MONEY;
}

/**
 * API representation of a non-negative amount: a decimal string with no sign
 * and no leading zeros, at most `MAX_MONEY`. It stays a string on the wire;
 * `parseAmount` converts it to `bigint` (README §3.4).
 */
export const amountSchema = z
  .string()
  .max(MAX_AMOUNT_LENGTH, "Amount is too long")
  .regex(unsignedPattern, "Expected a non-negative integer string without leading zeros")
  .refine(absWithinBounds, "Amount exceeds the maximum");

/** Like `amountSchema`, but rejects `"0"`. */
export const positiveAmountSchema = amountSchema.refine(
  (v) => v !== "0",
  "Amount must be positive",
);

/** Signed amount (e.g. a net wallet change): `amountSchema` plus an optional `-` on non-zero values. */
export const signedAmountSchema = z
  .string()
  .max(MAX_AMOUNT_LENGTH, "Amount is too long")
  .regex(signedPattern, "Expected an integer string without leading zeros")
  .refine(absWithinBounds, "Amount exceeds the maximum");

/** Converts minor units to the API string. Throws `RangeError` outside ±`MAX_MONEY`. */
export function toAmount(value: Money): string {
  if (value > MAX_MONEY || value < -MAX_MONEY) {
    throw new RangeError("Amount is outside the supported range");
  }
  return value.toString();
}

/** Converts an API string to minor units. Throws on invalid input. */
export function parseAmount(value: string): Money {
  return BigInt(signedAmountSchema.parse(value));
}

/** Formats minor units as credits for display, e.g. `123456n` -> `"1,234.56"`. */
export function formatCredits(value: Money): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = (abs / MINOR_UNITS_PER_CREDIT).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cents = (abs % MINOR_UNITS_PER_CREDIT).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${cents}`;
}
