import { z } from "zod";
import { MAX_MONEY, type Money } from "../money";
import type { Rng } from "../rng";
import type { Game, Wager } from "./game";

/** Pockets on a single-zero (European) wheel: 0 to 36. */
export const POCKET_COUNT = 37;

const pocketSchema = z.number().int().min(0).max(36);

/** What the player bets on. */
export const rouletteSelectionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("straight"), number: pocketSchema }),
  z.object({ type: z.literal("color"), color: z.enum(["red", "black"]) }),
  z.object({ type: z.literal("parity"), parity: z.enum(["odd", "even"]) }),
  z.object({
    type: z.literal("dozen"),
    dozen: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  }),
]);
export type RouletteSelection = z.infer<typeof rouletteSelectionSchema>;

export const rouletteResultSchema = z.object({ number: pocketSchema });
export type RouletteResult = z.infer<typeof rouletteResultSchema>;

export type RouletteBet = Wager & { selection: RouletteSelection };

const RED_NUMBERS: ReadonlySet<number> = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

export type PocketColor = "red" | "black" | "green";

export function pocketColor(pocket: number): PocketColor {
  if (pocket === 0) return "green";
  return RED_NUMBERS.has(pocket) ? "red" : "black";
}

/** Total returned per unit staked, stake included, when the selection wins. */
const MULTIPLIERS: Record<RouletteSelection["type"], Money> = {
  straight: 36n,
  color: 2n,
  parity: 2n,
  dozen: 3n,
};

function wins(selection: RouletteSelection, pocket: number): boolean {
  switch (selection.type) {
    case "straight":
      return pocket === selection.number;
    case "color":
      return pocketColor(pocket) === selection.color;
    case "parity":
      // Zero is neither odd nor even: outside bets lose on it.
      return pocket !== 0 && (pocket % 2 === 1 ? "odd" : "even") === selection.parity;
    case "dozen":
      return pocket !== 0 && Math.ceil(pocket / 12) === selection.dozen;
  }
}

/** Roulette rules (README §4.1). Pure, so the browser verifier runs this exact code. */
export const roulette: Game<RouletteBet, RouletteResult> = {
  id: "roulette",

  validateBet(bet) {
    if (bet.stake <= 0n) return false;
    if (!rouletteSelectionSchema.safeParse(bet.selection).success) return false;
    // The largest payout must still fit in a bigint column.
    return bet.stake * MULTIPLIERS[bet.selection.type] <= MAX_MONEY;
  },

  resolve(_bet, rng: Rng) {
    return { number: rng.int(POCKET_COUNT) };
  },

  payout(bet, result) {
    return wins(bet.selection, result.number) ? bet.stake * MULTIPLIERS[bet.selection.type] : 0n;
  },
};
