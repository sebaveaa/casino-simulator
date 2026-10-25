import {
  chickenRoadPayout,
  MAX_STAKE,
  MIN_STAKE,
  MINOR_UNITS_PER_CREDIT,
  type Money,
  parseAmount,
} from "@casino/shared";
import { shortCredits } from "../roulette/money";

/** A multiplier from integer hundredths, with a decimal comma: 187 → "1,87x". No floats. */
export function formatMultiplier(hundredths: number): string {
  const whole = Math.trunc(hundredths / 100);
  const cents = String(hundredths % 100).padStart(2, "0");
  return `${whole},${cents}x`;
}

/** Credits as the screens show them ("10", "12.50"), from an API amount or minor units. */
export function credits(amount: string | Money): string {
  return shortCredits(typeof amount === "string" ? parseAmount(amount) : amount);
}

/** "Ganancia": payout minus stake, in BigInt from the API strings. */
export function gainOf(payout: string, stake: string): Money {
  return parseAmount(payout) - parseAmount(stake);
}

/** "Habrías cobrado": what retiring after `lanes` lanes would have paid. Display only. */
export function wouldHaveWon(stake: string, lanes: number): Money {
  return chickenRoadPayout(parseAmount(stake), lanes);
}

/** Step of the amount field and quick buttons, in credits. */
export const STAKE_STEP_CREDITS = 10n;
export const QUICK_STAKES = [10, 50, 100, 500] as const;

/**
 * The stake typed in whole credits as an API amount (minor units), or null when it is not a whole
 * number of credits from 10 to 500 in steps of 10, like the field's min, max and step.
 */
export function stakeFromInput(text: string): string | null {
  if (!/^\d{1,4}$/.test(text.trim())) return null;
  const creditsTyped = BigInt(text.trim());
  const minor = creditsTyped * MINOR_UNITS_PER_CREDIT;
  if (minor < MIN_STAKE || minor > MAX_STAKE || creditsTyped % STAKE_STEP_CREDITS !== 0n) {
    return null;
  }
  return minor.toString();
}
