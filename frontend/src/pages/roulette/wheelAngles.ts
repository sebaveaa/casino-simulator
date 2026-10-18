import { POCKET_COUNT } from "@casino/shared";

/** Pockets of a European single-zero wheel, clockwise from the zero. */
export const WHEEL_ORDER: readonly number[] = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14,
  31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];

const TAU = Math.PI * 2;
export const POCKET_ANGLE = TAU / POCKET_COUNT;

/**
 * Angle of a pocket's centre on the wheel, clockwise from the top while the wheel is not
 * rotated. Rotating the wheel by `-pocketAngle(n)` puts pocket `n` under the pointer.
 */
export function pocketAngle(pocket: number): number {
  const index = WHEEL_ORDER.indexOf(pocket);
  if (index < 0) throw new RangeError(`Not a roulette pocket: ${pocket}`);
  return index * POCKET_ANGLE;
}

/**
 * Wheel rotation (radians, clockwise) that lands `pocket` under the pointer. It is always at
 * least `turns` full turns ahead of `current`, so the wheel only ever spins forward.
 */
export function spinTarget(current: number, pocket: number, turns: number): number {
  const rest = (((-pocketAngle(pocket) - current) % TAU) + TAU) % TAU;
  return current + turns * TAU + rest;
}

/** Fast start, slow finish. `t` is clamped to [0, 1]. */
export function easeOutCubic(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - (1 - clamped) ** 3;
}
