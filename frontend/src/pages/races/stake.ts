import { parseAmount } from "@casino/shared";
import { creditsToAmount } from "../creditsInput";
import { shortCredits } from "../roulette/money";

/** Stake limits shown to the player, in whole credits. The server enforces the real ones. */
export const MIN_STAKE_CREDITS = 1n;
export const MAX_STAKE_CREDITS = 1000n;

const wholeCredits = /^\d+$/;

/**
 * Converts the typed stake ("25") to an API amount in minor units ("2500"). Returns null unless it
 * is a whole number of credits within the shown limits.
 */
export function stakeFromCredits(input: string): string | null {
  const text = input.trim();
  if (!wholeCredits.test(text)) return null;
  const credits = BigInt(text);
  if (credits < MIN_STAKE_CREDITS || credits > MAX_STAKE_CREDITS) return null;
  return creditsToAmount(text);
}

/** An API amount as "10 créditos" (or "1 crédito"), for sentences. */
export function creditsText(amount: string): string {
  const minor = parseAmount(amount);
  return `${shortCredits(minor)} ${minor === 100n ? "crédito" : "créditos"}`;
}
