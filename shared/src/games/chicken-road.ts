import { z } from "zod";
import { MINOR_UNITS_PER_CREDIT, type Money } from "../money";
import type { Rng } from "../rng";
import type { Game, Wager } from "./game";

/** Lanes between the start and the goal. */
export const LANE_COUNT = 6;

/** A lane is crossed when `rng.int(100)` falls below this: 80 % per lane. */
export const SURVIVAL_PERCENT = 80;

/** Expected return to the player, in percent, at every lane. */
export const RTP_PERCENT = 96;

/** Stake bounds: 10 to 500 credits, in minor units. */
export const MIN_STAKE: Money = 10n * MINOR_UNITS_PER_CREDIT;
export const MAX_STAKE: Money = 500n * MINOR_UNITS_PER_CREDIT;

/**
 * Multiplier after crossing lane k, in hundredths (`187` is 1.87x):
 * floor(RTP / p^k) = floor(96 * 100^k / 80^k), in integers only. The float form
 * `100 * 0.96 / 0.8 ** k` gives 149 instead of 150 for k = 2.
 */
function multiplierHundredths(lanes: number): number {
  const k = BigInt(lanes);
  return Number((BigInt(RTP_PERCENT) * 100n ** k) / BigInt(SURVIVAL_PERCENT) ** k);
}

/** Index `k - 1` holds the multiplier after `k` lanes: [120, 150, 187, 234, 292, 366]. */
export const CHICKEN_ROAD_MULTIPLIERS: readonly number[] = Array.from(
  { length: LANE_COUNT },
  (_, i) => multiplierHundredths(i + 1),
);

const laneSchema = z.number().int().min(1).max(LANE_COUNT);

/** The road, fixed when the game starts: the lane the car hits, or `null` if none does. */
export const chickenRoadResultSchema = z.object({ hitLane: laneSchema.nullable() });
export type ChickenRoadResult = z.infer<typeof chickenRoadResultSchema>;

/**
 * A finished game as one bet: `cashOutAt` is how many lanes the player tried to cross before
 * cashing out (6 is the goal, paid automatically). A game hit on lane h is any `cashOutAt >= h`.
 */
export type ChickenRoadBet = Wager & { cashOutAt: number };

/** Multiplier in hundredths after crossing `lanes` lanes (1 to 6). */
export function chickenRoadMultiplier(lanes: number): number {
  const multiplier = CHICKEN_ROAD_MULTIPLIERS[lanes - 1];
  if (!Number.isInteger(lanes) || multiplier === undefined) {
    throw new RangeError(`lanes must be an integer from 1 to ${LANE_COUNT}`);
  }
  return multiplier;
}

/** Total paid when cashing out after `lanes` lanes, stake included: floor(stake * mult / 100). */
export function chickenRoadPayout(stake: Money, lanes: number): Money {
  return (stake * BigInt(chickenRoadMultiplier(lanes))) / 100n;
}

/** Checks the stake alone, as the game starts and no cash-out point exists yet. */
export function isValidChickenRoadStake(stake: Money): boolean {
  return stake >= MIN_STAKE && stake <= MAX_STAKE;
}

/** Chicken Road rules (PLAN-MINI-GAMES §3.2). Pure, so the browser verifier runs this exact code. */
export const chickenRoad: Game<ChickenRoadBet, ChickenRoadResult> & {
  readonly id: "chicken-road";
} = {
  id: "chicken-road",

  validateBet(bet) {
    return isValidChickenRoadStake(bet.stake) && laneSchema.safeParse(bet.cashOutAt).success;
  },

  /**
   * Draws `rng.int(100)` for lanes 1, 2, ... and stops at the first draw of `SURVIVAL_PERCENT`
   * or more: that lane is `hitLane`. The bet is ignored, so the road is fixed at the start.
   */
  resolve(_bet, rng: Rng) {
    for (let lane = 1; lane <= LANE_COUNT; lane++) {
      if (rng.int(100) >= SURVIVAL_PERCENT) return { hitLane: lane };
    }
    return { hitLane: null };
  },

  payout(bet, result) {
    if (result.hitLane !== null && result.hitLane <= bet.cashOutAt) return 0n;
    return chickenRoadPayout(bet.stake, bet.cashOutAt);
  },
};
