import { formatCredits, type Money, parseAmount } from "@casino/shared";

/** A multiplier in hundredths as Spanish text with two decimals: `245` -> `"2,45x"`. */
export function formatMultiplier(hundredths: number): string {
  const whole = Math.floor(hundredths / 100);
  const cents = (hundredths % 100).toString().padStart(2, "0");
  return `${whole},${cents}x`;
}

/** Credits for display from an API amount string (minor units). */
export function creditsFromAmount(amount: string): string {
  return formatCredits(parseAmount(amount));
}

/** Credits for display from minor units. */
export function creditsFromMinor(value: Money): string {
  return formatCredits(value);
}

/**
 * A whole-credits input (10 to 500) to an API stake string in minor units, or null when it is not a
 * plain whole number. The server enforces the bounds; the panel only blocks obvious nonsense.
 */
export function stakeMinorFromCredits(text: string): string | null {
  const trimmed = text.trim();
  if (!/^\d{1,6}$/.test(trimmed)) return null;
  return String(Number(trimmed) * 100);
}

/** Minor-unit bounds as whole credits, for the hint text. */
export function limitsInCredits(limits: { minStake: string; maxStake: string }): {
  min: number;
  max: number;
} {
  return {
    min: Math.round(Number(limits.minStake) / 100),
    max: Math.round(Number(limits.maxStake) / 100),
  };
}
