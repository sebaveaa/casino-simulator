import type { CurrentRaceResponse, RaceEvent, RaceRound, RoundStatus } from "@casino/shared";

/**
 * How long the race animation lasts. Same default as the backend `RACE_DURATION_SECONDS` (10):
 * the server settles the round when the animation ends.
 */
export const RACE_ANIMATION_MS = 10_000;

/** How many replaced rounds are remembered to drop their late events. */
const PAST_ROUNDS_KEPT = 20;

/** The player's bet on the current round, as the API reports it. Amounts are API strings. */
export interface MyBet {
  animal: number;
  stake: string;
  /** Total returned once the round is settled ("0" when the bet lost); null before that. */
  payout: string | null;
}

/**
 * What the page knows about the race. Every value comes from the API (snapshot or event); the
 * reducer only decides which of two reports is newer, never a result or an amount.
 */
export interface RaceState {
  /** True once the first `getCurrentRace` answered. */
  loaded: boolean;
  round: RaceRound | null;
  myBet: MyBet | null;
  /** Server-clock time at which the track animation starts; null when there is no result. */
  startedAtMs: number | null;
  /** Rounds replaced by a newer one: their late events are ignored. */
  pastRoundIds: string[];
  /**
   * Bumped when the page must fetch the current race again: an event for a round it does not
   * know (it missed the `opened`) or a settlement whose payout or result it has not seen.
   */
  syncRequest: number;
}

export type RaceAction =
  | { type: "snapshot"; response: CurrentRaceResponse; nowMs: number }
  | { type: "event"; event: RaceEvent; nowMs: number }
  | { type: "bet"; roundId: string; bet: MyBet };

export const initialRaceState: RaceState = {
  loaded: false,
  round: null,
  myBet: null,
  startedAtMs: null,
  pastRoundIds: [],
  syncRequest: 0,
};

const RANK: Record<RoundStatus, number> = { open: 0, closed: 1, resolved: 2, settled: 3 };

/** The later of two statuses of the same round: a late report never moves a round back. */
function laterStatus(a: RoundStatus, b: RoundStatus): RoundStatus {
  return RANK[b] > RANK[a] ? b : a;
}

/**
 * When the animation of `round` starts. A fetched round carries `settlesAt`, the end of the
 * animation, so a late joiner sees only what is left of it (or the finish line). Without it, a
 * live result starts now and a settled round shows the final positions (null).
 */
function startOf(round: RaceRound, nowMs: number): number | null {
  if (!round.result) return null;
  if (round.settlesAt) return Date.parse(round.settlesAt) - RACE_ANIMATION_MS;
  return round.status === "settled" ? null : nowMs;
}

function mergeRound(known: RaceRound, report: RaceRound): RaceRound {
  return {
    ...known,
    status: laterStatus(known.status, report.status),
    result: report.result ?? known.result,
    serverSeed: report.serverSeed ?? known.serverSeed,
    settlesAt: report.settlesAt ?? known.settlesAt,
  };
}

/** Keeps the most informed of two reports of the same bet: one with a payout wins. */
function mergeBet(known: MyBet | null, report: MyBet | null): MyBet | null {
  if (!known) return report;
  if (!report) return known;
  return report.payout !== null ? report : known;
}

/** True for a round older than the one on screen, which must not replace it. */
function isStale(state: RaceState, round: RaceRound): boolean {
  if (state.pastRoundIds.includes(round.id)) return true;
  return state.round !== null && Date.parse(round.opensAt) < Date.parse(state.round.opensAt);
}

/** Puts a newer round on screen; the bet and the animation start over. */
function replaceRound(
  state: RaceState,
  round: RaceRound,
  myBet: MyBet | null,
  nowMs: number,
): RaceState {
  const pastRoundIds = state.round
    ? [...state.pastRoundIds, state.round.id].slice(-PAST_ROUNDS_KEPT)
    : state.pastRoundIds;
  return { ...state, round, myBet, startedAtMs: startOf(round, nowMs), pastRoundIds };
}

/** Applies a report of the round on screen (same id) or of a newer one. */
function applyRound(
  state: RaceState,
  round: RaceRound,
  myBet: MyBet | null,
  nowMs: number,
): RaceState {
  const known = state.round;
  if (known && known.id === round.id) {
    const merged = mergeRound(known, round);
    return {
      ...state,
      round: merged,
      myBet: mergeBet(state.myBet, myBet),
      startedAtMs: state.startedAtMs ?? startOf(merged, nowMs),
    };
  }
  if (isStale(state, round)) return state;
  return replaceRound(state, round, myBet, nowMs);
}

function applyEvent(state: RaceState, event: RaceEvent, nowMs: number): RaceState {
  if (event.type === "opened") return applyRound(state, event.round, null, nowMs);

  const round = state.round;
  if (!round || round.id !== event.roundId) {
    // An old round's late event changes nothing; an unknown round means an `opened` was missed.
    if (state.pastRoundIds.includes(event.roundId)) return state;
    return { ...state, syncRequest: state.syncRequest + 1 };
  }

  if (event.type === "closed") {
    return { ...state, round: { ...round, status: laterStatus(round.status, "closed") } };
  }
  if (event.type === "result") {
    return {
      ...state,
      round: {
        ...round,
        status: laterStatus(round.status, "resolved"),
        result: event.result,
        serverSeed: event.serverSeed,
      },
      startedAtMs: state.startedAtMs ?? nowMs,
    };
  }
  // settled: the event carries no amounts, so the payout comes from a fresh fetch.
  const missing = !round.result || (state.myBet !== null && state.myBet.payout === null);
  return {
    ...state,
    round: { ...round, status: "settled" },
    syncRequest: missing ? state.syncRequest + 1 : state.syncRequest,
  };
}

export function raceReducer(state: RaceState, action: RaceAction): RaceState {
  switch (action.type) {
    case "snapshot": {
      const { round, myBet } = action.response;
      const loaded = { ...state, loaded: true };
      // "No round" never wipes one on screen: a settled outcome stays until the next `opened`.
      if (!round) return loaded;
      return applyRound(loaded, round, myBet, action.nowMs);
    }
    case "event":
      return applyEvent(state, action.event, action.nowMs);
    case "bet":
      if (state.round?.id !== action.roundId) return state;
      return { ...state, myBet: mergeBet(state.myBet, action.bet) };
  }
}
