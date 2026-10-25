import { z } from "zod";
import { MINOR_UNITS_PER_CREDIT, type Money } from "../money";
import { computeRoundOutcome, createRng, hashServerSeed, type Outcome, type Rng } from "../rng";

/**
 * The two Crash games share this engine; only their animation differs (PLAN-CRASH §1). "aviator"
 * is an internal identifier only: the name never reaches the interface, where the game is called
 * "Despegue".
 */
export const CRASH_GAMES = ["dino-crash", "aviator"] as const;
export const crashGameSchema = z.enum(CRASH_GAMES);
export type CrashGame = z.infer<typeof crashGameSchema>;

/** Stake bounds: 10 to 500 credits, in minor units. */
export const CRASH_MIN_STAKE: Money = 10n * MINOR_UNITS_PER_CREDIT;
export const CRASH_MAX_STAKE: Money = 500n * MINOR_UNITS_PER_CREDIT;

/**
 * Round timings are fixed game constants, not per-deployment settings (PLAN-CRASH §3.1 calls the
 * window "constante"). Both the worker and the current-round query read them from here, so the API
 * needs no new environment configuration. `CRASH_BETTING_WINDOW_MS` is how long a round accepts
 * bets before takeoff; `CRASH_INTERMISSION_MS` is the pause after a round settles before the next
 * one opens (and how long the finished round stays on screen).
 */
export const CRASH_BETTING_WINDOW_MS = 5000;
export const CRASH_INTERMISSION_MS = 3000;

/** Multiplier bounds in hundredths: 1.00x to the 20.00x cap (PLAN-CRASH §3.1). */
export const MIN_MULTIPLIER_HUNDREDTHS = 100;
export const MAX_MULTIPLIER_HUNDREDTHS = 2000;

/**
 * House edge in the impact distribution: the probability of reaching multiplier `x` is `0.99 / x`,
 * so the house keeps 1 %. Encoded as the numerator `99_000_000` over a million-wide draw.
 */
export const CRASH_EDGE_NUMERATOR = 99_000_000n;
export const CRASH_DRAW_RANGE = 1_000_000;

/** Exponential growth of the multiplier per millisecond: 2x at ~11.5 s, 20x at ~50 s. */
export const CRASH_GROWTH_PER_MS = 0.00006;

/**
 * The round outcome, fixed when the round opens and revealed with the seed at impact. `cap` means
 * the flight reached the 20.00x ceiling; everyone still in is paid 20.00x (PLAN-CRASH §3.5).
 */
export const crashResultSchema = z.object({
  crashHundredths: z.number().int().min(MIN_MULTIPLIER_HUNDREDTHS).max(MAX_MULTIPLIER_HUNDREDTHS),
  outcome: z.enum(["impact", "cap"]),
});
export type CrashResult = z.infer<typeof crashResultSchema>;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * The impact point of a round from its RNG (PLAN-CRASH §3.2): draws `r` in `[0, 1_000_000)` and
 * computes `floor(99_000_000 / (1_000_000 - r))`, clamped to `[100, 2000]`. BigInt division keeps
 * it exact. P(crash >= x) = 0.99 / x, so ~1 % of rounds end at 1.00x (immediate impact) and the
 * cap is reached about once every 20 rounds.
 */
export function resolveCrash(rng: Rng): CrashResult {
  const r = rng.int(CRASH_DRAW_RANGE);
  const raw = Number(CRASH_EDGE_NUMERATOR / BigInt(CRASH_DRAW_RANGE - r));
  const crashHundredths = clamp(raw, MIN_MULTIPLIER_HUNDREDTHS, MAX_MULTIPLIER_HUNDREDTHS);
  return {
    crashHundredths,
    outcome: crashHundredths >= MAX_MULTIPLIER_HUNDREDTHS ? "cap" : "impact",
  };
}

/**
 * The multiplier shown after `elapsedMs` of flight, in hundredths:
 * `floor(100 * e^(0.00006 * ms))`. The browser animates with this exact function, so no per-tick
 * message from the server is needed (PLAN-CRASH §3.3). At `ms = 0` it is 100 (1.00x).
 */
export function multiplierAtHundredths(elapsedMs: number): number {
  if (elapsedMs <= 0) return MIN_MULTIPLIER_HUNDREDTHS;
  return Math.floor(100 * Math.exp(CRASH_GROWTH_PER_MS * elapsedMs));
}

/**
 * The inverse of {@link multiplierAtHundredths}: the instant, in ms since takeoff, when the
 * multiplier first reaches `crashHundredths`. `ceil(ln(crash / 100) / 0.00006)`. A cash-out at
 * `elapsedMs` is valid only while `elapsedMs < impactAtMs(crash)`.
 */
export function impactAtMs(crashHundredths: number): number {
  if (crashHundredths <= MIN_MULTIPLIER_HUNDREDTHS) return 0;
  return Math.ceil(Math.log(crashHundredths / 100) / CRASH_GROWTH_PER_MS);
}

/** Whether a cash-out at `elapsedMs` lands before the impact of a round with this crash point. */
export function canCashOut(elapsedMs: number, crashHundredths: number): boolean {
  return elapsedMs >= 0 && elapsedMs < impactAtMs(crashHundredths);
}

/** Total paid when cashing out at `cashoutHundredths`, stake included: `floor(stake * mult / 100)`. */
export function crashPayout(stake: Money, cashoutHundredths: number): Money {
  return (stake * BigInt(cashoutHundredths)) / 100n;
}

/** Checks the stake alone, as a bet is placed before any cash-out point exists. */
export function isValidCrashStake(stake: Money): boolean {
  return stake >= CRASH_MIN_STAKE && stake <= CRASH_MAX_STAKE;
}

/**
 * Recomputes a finished round for the browser verifier (#15): checks the published hash against
 * the revealed seed and derives the impact point the exact same way the server did. Pure except
 * for the Web Crypto digest, which is identical in Node and the browser (see `../rng`).
 */
export async function verifyCrashRound(
  serverSeed: string,
  roundId: string,
  serverSeedHash: string,
): Promise<{ hashValid: boolean; result: CrashResult }> {
  const hashValid = (await hashServerSeed(serverSeed)) === serverSeedHash;
  const result = resolveCrash(createRng(await computeRoundOutcome(serverSeed, roundId)));
  return { hashValid, result };
}

/** The impact point of a round from its outcome string, for callers that already have the RNG seed. */
export function crashResultFromOutcome(outcome: Outcome): CrashResult {
  return resolveCrash(createRng(outcome));
}
