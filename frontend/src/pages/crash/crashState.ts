import type {
  CrashCurrentResponse,
  CrashEvent,
  CrashPlayerBet,
  CrashRound,
  CrashRoundStatus,
} from "@casino/shared";

/** How many replaced rounds are remembered to drop their late events. */
const PAST_ROUNDS_KEPT = 20;

/**
 * What the page knows about a Crash game. Every value comes from the API (snapshot or event); the
 * reducer only decides which of two reports is newer, never a result or an amount.
 */
export interface CrashState {
  /** True once the first `getCurrentCrash` answered. */
  loaded: boolean;
  /** The stake limits (minor units) of the latest snapshot; null until one answers. */
  limits: { minStake: string; maxStake: string } | null;
  round: CrashRound | null;
  myBet: CrashPlayerBet | null;
  /** Server-clock time (ms) of takeoff — the round's `closesAt`; null while still open. */
  startedAtMs: number | null;
  /** Rounds replaced by a newer one: their late events are ignored. */
  pastRoundIds: string[];
  /** Bumped when the page must fetch again: an unknown round, or a settlement it has not seen. */
  syncRequest: number;
}

export type CrashAction =
  | { type: "snapshot"; response: CrashCurrentResponse }
  | { type: "event"; event: CrashEvent }
  | { type: "bet"; roundId: string; bet: CrashPlayerBet }
  | { type: "cashout"; betId: string; cashoutHundredths: number; payout: string };

export const initialCrashState: CrashState = {
  loaded: false,
  limits: null,
  round: null,
  myBet: null,
  startedAtMs: null,
  pastRoundIds: [],
  syncRequest: 0,
};

const RANK: Record<CrashRoundStatus, number> = { open: 0, closed: 1, resolved: 2, settled: 3 };

/** The later of two statuses of the same round: a late report never moves a round back. */
function laterStatus(a: CrashRoundStatus, b: CrashRoundStatus): CrashRoundStatus {
  return RANK[b] > RANK[a] ? b : a;
}

/** Takeoff instant of `round`: its `closesAt` once it has left the betting window, else null. */
function startOf(round: CrashRound): number | null {
  if (round.status === "open") return null;
  return Date.parse(round.closesAt);
}

function mergeRound(known: CrashRound, report: CrashRound): CrashRound {
  return {
    ...known,
    status: laterStatus(known.status, report.status),
    result: report.result ?? known.result,
    serverSeed: report.serverSeed ?? known.serverSeed,
  };
}

/** Keeps the most informed of two reports of the same bet: a settled one wins. */
function mergeBet(
  known: CrashPlayerBet | null,
  report: CrashPlayerBet | null,
): CrashPlayerBet | null {
  if (!known) return report;
  if (!report) return known;
  return report.status === "settled" ? report : known;
}

function isStale(state: CrashState, round: CrashRound): boolean {
  if (state.pastRoundIds.includes(round.id)) return true;
  return state.round !== null && Date.parse(round.opensAt) < Date.parse(state.round.opensAt);
}

function replaceRound(
  state: CrashState,
  round: CrashRound,
  myBet: CrashPlayerBet | null,
): CrashState {
  const pastRoundIds = state.round
    ? [...state.pastRoundIds, state.round.id].slice(-PAST_ROUNDS_KEPT)
    : state.pastRoundIds;
  return { ...state, round, myBet, startedAtMs: startOf(round), pastRoundIds };
}

function applyRound(
  state: CrashState,
  round: CrashRound,
  myBet: CrashPlayerBet | null,
): CrashState {
  const known = state.round;
  if (known && known.id === round.id) {
    const merged = mergeRound(known, round);
    return {
      ...state,
      round: merged,
      myBet: mergeBet(state.myBet, myBet),
      startedAtMs: state.startedAtMs ?? startOf(merged),
    };
  }
  if (isStale(state, round)) return state;
  return replaceRound(state, round, myBet);
}

function applyEvent(state: CrashState, event: CrashEvent): CrashState {
  if (event.type === "opened") return applyRound(state, event.round, null);

  const round = state.round;
  if (!round || round.id !== event.roundId) {
    if (state.pastRoundIds.includes(event.roundId)) return state;
    return { ...state, syncRequest: state.syncRequest + 1 };
  }

  if (event.type === "takeoff") {
    const next = { ...round, status: laterStatus(round.status, "closed") };
    return { ...state, round: next, startedAtMs: state.startedAtMs ?? startOf(next) };
  }
  if (event.type === "impact") {
    const next: CrashRound = {
      ...round,
      status: laterStatus(round.status, "resolved"),
      result: event.result,
      serverSeed: event.serverSeed,
    };
    return { ...state, round: next, startedAtMs: state.startedAtMs ?? startOf(next) };
  }
  if (event.type === "settled") {
    // The event carries no amounts, so the payout comes from a fresh fetch.
    const missing = !round.result || (state.myBet !== null && state.myBet.status !== "settled");
    return {
      ...state,
      round: { ...round, status: "settled" },
      syncRequest: missing ? state.syncRequest + 1 : state.syncRequest,
    };
  }
  // cashout: an aggregate, no amounts; the player's own cash-out is applied from its API response.
  return state;
}

export function crashReducer(state: CrashState, action: CrashAction): CrashState {
  switch (action.type) {
    case "snapshot": {
      const { round, myBet, limits } = action.response;
      const loaded = { ...state, loaded: true, limits };
      if (!round) return loaded;
      return applyRound(loaded, round, myBet);
    }
    case "event":
      return applyEvent(state, action.event);
    case "bet":
      if (state.round?.id !== action.roundId) return state;
      return { ...state, myBet: mergeBet(state.myBet, action.bet) };
    case "cashout": {
      if (!state.myBet || state.myBet.betId !== action.betId) return state;
      return {
        ...state,
        myBet: {
          ...state.myBet,
          status: "settled",
          cashoutHundredths: action.cashoutHundredths,
          payout: action.payout,
        },
      };
    }
  }
}
