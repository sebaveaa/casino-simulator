import {
  POCKET_COUNT,
  type PocketColor,
  type RouletteSelection,
  roulette,
  selectionKey,
} from "@casino/shared";

export const COLOR_NAMES: Record<PocketColor, string> = {
  red: "rojo",
  black: "negro",
  green: "verde",
};

/** Rows of the 1-36 grid as printed on a table: top 3, 6 ... 36; then 2, 5 ... 35; then 1 ... 34. */
export const GRID_ROWS: readonly (readonly number[])[] = [3, 2, 1].map((offset) =>
  Array.from({ length: 12 }, (_, column) => column * 3 + offset),
);

export const DOZENS = [1, 2, 3] as const;

/** Full name of a selection, for assistive technology. */
export function selectionLabel(selection: RouletteSelection): string {
  switch (selection.type) {
    case "straight":
      return `Número ${selection.number}`;
    case "color":
      return selection.color === "red" ? "Rojo" : "Negro";
    case "parity":
      return selection.parity === "even" ? "Par" : "Impar";
    case "dozen": {
      const first = (selection.dozen - 1) * 12 + 1;
      return `${selection.dozen}ª docena (${first}-${first + 11})`;
    }
  }
}

/** Short name for small chips: "17", "Negro", "2ª doc.". */
export function shortLabel(selection: RouletteSelection): string {
  switch (selection.type) {
    case "straight":
      return String(selection.number);
    case "dozen":
      return `${selection.dozen}ª doc.`;
    default:
      return selectionLabel(selection);
  }
}

const multipliers = new Map<string, bigint>();

/**
 * Total returned per unit staked when the selection wins (2, 3 or 36), read from the shared
 * rules so the table never hardcodes a payout.
 */
export function multiplierOf(selection: RouletteSelection): bigint {
  const key = selectionKey(selection);
  const known = multipliers.get(key);
  if (known !== undefined) return known;
  let multiplier = 0n;
  for (let number = 0; number < POCKET_COUNT && multiplier === 0n; number++) {
    multiplier = roulette.payout({ stake: 1n, selection }, { number });
  }
  multipliers.set(key, multiplier);
  return multiplier;
}

/** Whether the selection pays when `number` comes up. */
export function winsOn(selection: RouletteSelection, number: number): boolean {
  return roulette.payout({ stake: 1n, selection }, { number }) > 0n;
}
