import { ANIMAL_COUNT } from "@casino/shared";

/*
 * Pure motion of the race. The server already decided the arrival order; this only turns it
 * into positions over time so the animation always ends exactly there.
 */

/** Progress at which the winner crosses the line. */
export const FIRST_FINISH = 0.8;
/** Progress at which the last animal crosses the line. */
export const LAST_FINISH = 0.98;

const FINISH_STEP = (LAST_FINISH - FIRST_FINISH) / (ANIMAL_COUNT - 1);

/**
 * Per-animal speed shape (by animal id). Above 1 the animal starts slow and sprints late,
 * below 1 it starts fast and fades, which gives lead changes before the line.
 */
const EXPONENTS = [1.35, 0.75, 1.1, 0.9, 1.25] as const;

/** Progress at which the animal in arrival position `rank` (0 = winner) crosses the line. */
export function finishProgress(rank: number): number {
  return FIRST_FINISH + FINISH_STEP * rank;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return value > 0 ? 1 : 0;
  return Math.min(1, Math.max(0, value));
}

/** Race progress in [0, 1] for a wall-clock time. A non-positive duration is already finished. */
export function trackProgress(nowMs: number, startedAtMs: number, durationMs: number): number {
  if (durationMs <= 0) return 1;
  return clamp01((nowMs - startedAtMs) / durationMs);
}

/**
 * Advance in [0, 1] of every animal (index = animal id) at `progress`. Each animal's advance
 * never decreases, and animals reach exactly 1 in the order of `order` (`order[0]` first).
 */
export function positionsAt(order: number[], progress: number): number[] {
  const p = clamp01(progress);
  const positions = new Array<number>(ANIMAL_COUNT).fill(0);
  order.forEach((animal, rank) => {
    const finish = finishProgress(rank);
    const t = Math.min(1, p / finish);
    positions[animal] = t >= 1 ? 1 : t ** (EXPONENTS[animal] ?? 1);
  });
  return positions;
}
