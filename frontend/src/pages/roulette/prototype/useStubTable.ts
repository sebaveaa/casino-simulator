// PROTOTYPE — throwaway, see branch prototype/12-roulette-table
import {
  formatCredits,
  MINOR_UNITS_PER_CREDIT,
  POCKET_COUNT,
  type PocketColor,
  pocketColor,
  type RouletteSelection,
  roulette,
} from "@casino/shared";
import { useEffect, useRef, useState } from "react";

/** Fake in-memory balance: 1000 credits, in minor units. */
export const STARTING_BALANCE = 1000n * MINOR_UNITS_PER_CREDIT;

export const POCKETS = Array.from({ length: POCKET_COUNT }, (_, n) => n);

/** Pocket order around a European wheel. */
export const WHEEL_ORDER = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14,
  31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];

export const COLOR_NAMES: Record<PocketColor, string> = {
  red: "rojo",
  black: "negro",
  green: "verde",
};

export type Bet = { selection: RouletteSelection; stake: bigint };

export type Round = {
  id: number;
  number: number;
  bets: Bet[];
  stake: bigint;
  /** Total returned, stake included. */
  payout: bigint;
  net: bigint;
};

export function credits(whole: number | bigint): bigint {
  return BigInt(whole) * MINOR_UNITS_PER_CREDIT;
}

/** "25" for whole credits, "12.50" otherwise. */
export function shortCredits(minor: bigint): string {
  return minor % MINOR_UNITS_PER_CREDIT === 0n
    ? (minor / MINOR_UNITS_PER_CREDIT).toString()
    : formatCredits(minor);
}

export function signedCredits(minor: bigint): string {
  return `${minor > 0n ? "+" : ""}${formatCredits(minor)}`;
}

export function selectionKey(selection: RouletteSelection): string {
  switch (selection.type) {
    case "straight":
      return `n${selection.number}`;
    case "color":
      return selection.color;
    case "parity":
      return selection.parity;
    case "dozen":
      return `d${selection.dozen}`;
  }
}

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

/** Total returned per unit staked when the selection wins, derived from the shared rules. */
export function multiplierOf(selection: RouletteSelection): bigint {
  for (const number of POCKETS) {
    const paid = roulette.payout({ stake: 1n, selection }, { number });
    if (paid > 0n) return paid;
  }
  return 0n;
}

export function payAtLabel(selection: RouletteSelection): string {
  return `Paga ${multiplierOf(selection) - 1n} a 1`;
}

export function totalStake(bets: Bet[]): bigint {
  return bets.reduce((sum, bet) => sum + bet.stake, 0n);
}

export function payoutFor(bets: Bet[], number: number): bigint {
  return bets.reduce((sum, bet) => sum + roulette.payout(bet, { number }), 0n);
}

/** Total returned for each of the 37 outcomes. */
export function payoutsByOutcome(bets: Bet[]): bigint[] {
  return POCKETS.map((number) => payoutFor(bets, number));
}

/** Net result (payout minus total stake) for each of the 37 outcomes. */
export function netsByOutcome(bets: Bet[]): bigint[] {
  const staked = totalStake(bets);
  return payoutsByOutcome(bets).map((payout) => payout - staked);
}

export function bigMax(values: bigint[]): bigint {
  return values.reduce((max, value) => (value > max ? value : max), values[0] ?? 0n);
}

export function bigMin(values: bigint[]): bigint {
  return values.reduce((min, value) => (value < min ? value : min), values[0] ?? 0n);
}

export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}

/** Animates a bigint toward `target`. Integer math only; jumps when motion is reduced. */
export function useCountUp(target: bigint, startAtZero = false, durationMs = 800): bigint {
  const [value, setValue] = useState(startAtZero ? 0n : target);
  const current = useRef(value);
  useEffect(() => {
    const from = current.current;
    if (from === target) return;
    if (prefersReducedMotion()) {
      current.current = target;
      setValue(target);
      return;
    }
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      const eased = 1 - (1 - progress) ** 3;
      const next =
        progress >= 1
          ? target
          : from + ((target - from) * BigInt(Math.round(eased * 1000))) / 1000n;
      current.current = next;
      setValue(next);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs]);
  return value;
}

/** Local stub of the table: balance, spin and history live in memory, nothing hits the API. */
export function useStubTable() {
  const [balance, setBalance] = useState(STARTING_BALANCE);
  const [history, setHistory] = useState<{ id: number; number: number }[]>([]);
  const [spinId, setSpinId] = useState(0);
  const [target, setTarget] = useState<number | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [round, setRound] = useState<Round | null>(null);
  const [lastBets, setLastBets] = useState<Bet[]>([]);
  const pending = useRef<Round | null>(null);

  /** The stake leaves the balance now; the payout returns when the wheel stops. */
  function spin(bets: Bet[]): boolean {
    const stake = totalStake(bets);
    if (spinning || stake <= 0n || stake > balance) return false;
    // PROTOTYPE stub: the real server draws this
    const number = Math.floor(Math.random() * 37);
    const payout = payoutFor(bets, number);
    pending.current = { id: spinId + 1, number, bets, stake, payout, net: payout - stake };
    setBalance((current) => current - stake);
    setLastBets(bets);
    setRound(null);
    setTarget(number);
    setSpinId((id) => id + 1);
    setSpinning(true);
    return true;
  }

  function onSpinEnd() {
    const settled = pending.current;
    if (!settled) return;
    pending.current = null;
    setBalance((current) => current + settled.payout);
    setHistory((past) => [{ id: settled.id, number: settled.number }, ...past].slice(0, 12));
    setRound(settled);
    setSpinning(false);
  }

  return {
    balance,
    history,
    spinId,
    target,
    spinning,
    round,
    lastBets,
    spin,
    onSpinEnd,
    clearRound: () => setRound(null),
    resetBalance: () => setBalance(STARTING_BALANCE),
  };
}

export { pocketColor };
