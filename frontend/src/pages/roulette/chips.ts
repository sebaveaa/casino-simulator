import { MINOR_UNITS_PER_CREDIT, type Money } from "@casino/shared";

/** Chip values in whole credits, as on the rack. */
export const CHIP_VALUES = [1, 5, 10, 25, 100] as const;
export type ChipValue = (typeof CHIP_VALUES)[number];

export const DEFAULT_CHIP: ChipValue = 5;

/** Minor units of a chip of `value` credits. */
export function chipAmount(value: ChipValue): Money {
  return BigInt(value) * MINOR_UNITS_PER_CREDIT;
}

/** Colour class of the highest chip that fits in `amount`; stacks take the colour of their sum. */
export function chipTier(amount: Money): string {
  const whole = amount / MINOR_UNITS_PER_CREDIT;
  if (whole >= 100n) return "roulette-chip-100";
  if (whole >= 25n) return "roulette-chip-25";
  if (whole >= 10n) return "roulette-chip-10";
  if (whole >= 5n) return "roulette-chip-5";
  return "roulette-chip-1";
}
