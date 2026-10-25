import { parseAmount } from "@casino/shared";
import { creditsToAmount } from "../creditsInput";
import { shortCredits } from "../roulette/money";

/** The stake limits the server reported (`GET /races/current`), as API amounts in minor units. */
export interface StakeLimits {
  minStake: string;
  maxStake: string;
}

const wholeCredits = /^\d+$/;

/**
 * Converts the typed stake ("25") to an API amount in minor units ("2500"). Returns null unless it
 * is a whole number of credits within the server's limits; null limits (not loaded yet) accept
 * nothing. The server enforces the real limits anyway.
 */
export function stakeFromCredits(input: string, limits: StakeLimits | null): string | null {
  if (!limits) return null;
  const text = input.trim();
  if (!wholeCredits.test(text)) return null;
  const amount = creditsToAmount(text);
  if (amount === null) return null;
  const minor = parseAmount(amount);
  if (minor < parseAmount(limits.minStake) || minor > parseAmount(limits.maxStake)) return null;
  return amount;
}

/** The limits as credits text ("1", "1000"), without thousands grouping, for hints and errors. */
export function limitsInCredits(limits: StakeLimits): { min: string; max: string } {
  return {
    min: shortCredits(parseAmount(limits.minStake)).replaceAll(",", ""),
    max: shortCredits(parseAmount(limits.maxStake)).replaceAll(",", ""),
  };
}

/** An API amount as "10 créditos" (or "1 crédito"), for sentences. */
export function creditsText(amount: string): string {
  const minor = parseAmount(amount);
  return `${shortCredits(minor)} ${minor === 100n ? "crédito" : "créditos"}`;
}
