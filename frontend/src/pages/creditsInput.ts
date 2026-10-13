import { positiveAmountSchema } from "@casino/shared";

const creditsPattern = /^(\d+)(?:\.(\d{1,2}))?$/;

/**
 * Converts text typed in credits ("12.34") to minor units as an API amount string ("1234").
 * Uses string arithmetic only, never floats. Returns null for anything that is not a positive
 * amount with at most two decimals, or that exceeds the API maximum.
 */
export function creditsToAmount(input: string): string | null {
  const match = creditsPattern.exec(input.trim());
  if (!match) return null;
  const whole = match[1] ?? "0";
  const cents = (match[2] ?? "").padEnd(2, "0");
  const minor = (BigInt(whole) * 100n + BigInt(cents)).toString();
  return positiveAmountSchema.safeParse(minor).success ? minor : null;
}
