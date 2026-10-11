import { z } from "zod";
import type { Wager } from "./game";

const pocketSchema = z.number().int().min(0).max(36);

/** What the player bets on. The `roulette: Game` implementation belongs to issue #12. */
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
