import {
  type AuthResponse,
  type BalanceResponse,
  CHICKEN_ROAD_HISTORY_DEFAULT_LIMIT,
  CHICKEN_ROAD_HISTORY_MAX_LIMIT,
  type ChickenRoadGame,
  type CurrentRaceResponse,
  chickenRoad,
  chickenRoadPayout,
  chickenRoadStartRequestSchema,
  chickenRoadStepRequestSchema,
  computeOutcome,
  computeRoundOutcome,
  createRng,
  type DepositRequest,
  type DepositResponse,
  type Fairness,
  hashServerSeed,
  LANE_COUNT,
  type LoginRequest,
  parseAmount,
  type RaceBetRequest,
  type RaceBetResponse,
  type RaceEvent,
  type RaceResult,
  type RaceRound,
  type RegisterRequest,
  type RouletteBetRequest,
  type RouletteBetResponse,
  racePayout,
  resolveRace,
  roulette,
  selectionKey,
  spinPayouts,
  type Transaction,
  type TransactionHistoryQueryInput,
  type TransactionHistoryResponse,
  toAmount,
  totalStake,
  validateSpin,
} from "@casino/shared";
import { createUnsignedJwt } from "../session/jwt";
import { type ApiClient, ApiError } from "./client";

const STARTING_BALANCE = 100000n;
const TOKEN_LIFETIME_SECONDS = 3600;
const MOCK_CLIENT_SEED = "mock-client-seed";
const DEFAULT_RACE_WINDOW_MS = 30000;
const DEFAULT_RACE_DURATION_MS = 10000;
const DEFAULT_RACE_INTERMISSION_MS = 8000;
const MIN_RACE_STAKE = 100n;
const MAX_RACE_STAKE = 100000n;

/** Random lowercase hex string; a stand-in for seeds and hashes in the mock. */
function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

interface MockRound {
  id: string;
  status: RaceRound["status"];
  opensAt: number;
  closesAt: number;
  settlesAt: number | null;
  serverSeed: string;
  serverSeedHash: string;
  result: RaceResult | null;
}

export interface MockRaceOptions {
  /** How long a round accepts bets. Default 30000. */
  windowMs?: number;
  /** Time between the result and the settlement. Default 10000. */
  durationMs?: number;
  /**
   * Pause between a settlement and the next round: the settled round stays current for it, like
   * the backend `RACE_INTERMISSION_SECONDS`. Default 8000.
   */
  intermissionMs?: number;
  /** Delay before the first round opens. Default 0. */
  startDelayMs?: number;
}

/** A stake as an amount, or null when it is not one. */
function stakeAmount(stake: string): bigint | null {
  try {
    return parseAmount(stake);
  } catch {
    return null;
  }
}

/** Same list, compared by value and in order, so key order inside the objects does not matter. */
function sameBets(a: RouletteBetRequest["bets"], b: RouletteBetRequest["bets"]): boolean {
  return (
    a.length === b.length &&
    a.every((item, i) => {
      const other = b[i];
      const stake = stakeAmount(item.stake);
      // A stake that is not an amount never matches, so it cannot replay a saved result.
      return (
        other !== undefined &&
        stake !== null &&
        stake === stakeAmount(other.stake) &&
        selectionKey(item.selection) === selectionKey(other.selection)
      );
    })
  );
}

function never(): never {
  throw new Error("A spin always has at least one bet");
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

/** A Chicken Road game as the mock stores it; the road stays inside the mock. */
type MockChickenGame = {
  gameId: string;
  key: string;
  stake: bigint;
  fairness: Fairness;
  hitLane: number | null;
  /** Lanes attempted; in a lost game the last one is the hit lane. */
  lanes: number;
  payout: bigint | null;
};

const conflict = (message: string) => new ApiError("conflict", message, 409);

/**
 * The game as the backend shows it (`backend/games/chicken-road/view.ts`). The in-progress shape
 * never carries `hitLane`.
 */
function chickenView(game: MockChickenGame): ChickenRoadGame {
  const base = { gameId: game.gameId, stake: toAmount(game.stake), fairness: game.fairness };
  if (game.payout === null) {
    return {
      status: "in_progress",
      ...base,
      lanesCrossed: game.lanes,
      cashoutAmount: game.lanes === 0 ? "0" : toAmount(chickenRoadPayout(game.stake, game.lanes)),
    };
  }
  if (game.payout === 0n) {
    return {
      status: "lost",
      ...base,
      lanesCrossed: game.lanes - 1,
      hitLane: game.lanes,
      payout: "0",
    };
  }
  if (game.lanes === LANE_COUNT) {
    return {
      status: "completed",
      ...base,
      lanesCrossed: LANE_COUNT,
      payout: toAmount(game.payout),
    };
  }
  return { status: "cashed_out", ...base, lanesCrossed: game.lanes, payout: toAmount(game.payout) };
}

/**
 * In-memory `ApiClient` for developing screens without a backend. Roulette spins run the shared
 * rules (`validateSpin`, `roulette.resolve`, `spinPayouts`) over a fixed mock seed pair, so payouts match
 * the real API; only the seeds and persistence are fake.
 *
 * Chicken Road mirrors the backend (#45): one game in progress, the road from `chickenRoad.resolve`
 * over one fixed mock seed pair, replayed starts and steps, a single payout, and lane 6 paid
 * automatically. Unlike the backend, it has no abandonment timer, and roulette spins do not
 * advance the seed pair's nonce.
 *
 * `chickenRoads` lets tests fix the road: the hit lane (or `null` for none) of each next game, in
 * order. Once it runs out, the seed decides again.
 */
export function createMockApiClient(
  options: {
    delayMs?: number;
    startingBalance?: bigint;
    chickenRoads?: (number | null)[];
    race?: MockRaceOptions;
  } = {},
): ApiClient {
  const delayMs = options.delayMs ?? 0;
  const windowMs = options.race?.windowMs ?? DEFAULT_RACE_WINDOW_MS;
  const durationMs = options.race?.durationMs ?? DEFAULT_RACE_DURATION_MS;
  const intermissionMs = options.race?.intermissionMs ?? DEFAULT_RACE_INTERMISSION_MS;
  const startDelayMs = options.race?.startDelayMs ?? 0;
  let balance = options.startingBalance ?? STARTING_BALANCE;
  const fixedRoads = [...(options.chickenRoads ?? [])];
  const transactions: Transaction[] = [];
  const deposits = new Map<string, DepositResponse>();
  const bets = new Map<string, { request: RouletteBetRequest; response: RouletteBetResponse }>();

  // email -> account. Passwords are kept in plain text: this is a dev-only stand-in.
  const users = new Map<string, { id: string; password: string }>();

  // The one Chicken Road seed pair, and the games in the order they started.
  const seedPair = { id: crypto.randomUUID(), serverSeed: crypto.randomUUID(), nextNonce: 0 };
  const chickenGames: MockChickenGame[] = [];

  function findChickenGame(gameId: string): MockChickenGame {
    const game = chickenGames.find((g) => g.gameId === gameId);
    if (!game) throw new ApiError("not_found", "Chicken Road game not found", 404);
    return game;
  }

  /** Settles a game; a positive payout goes to the balance once, as one `payout` transaction. */
  function settleChicken(game: MockChickenGame, payout: bigint): void {
    game.payout = payout;
    if (payout > 0n) {
      balance += payout;
      record("payout", payout, game.gameId);
    }
  }

  const chickenResponse = (game: MockChickenGame) => ({
    game: chickenView(game),
    balance: toAmount(balance),
  });

  const session = (id: string, email: string): AuthResponse => ({
    token: createUnsignedJwt({
      sub: id,
      role: "player",
      exp: Math.floor(Date.now() / 1000) + TOKEN_LIFETIME_SECONDS,
    }),
    user: { id, email, role: "player" },
  });

  function record(type: Transaction["type"], amount: bigint, betId: string | null): string {
    const id = crypto.randomUUID();
    transactions.push({
      id,
      type,
      amount: amount.toString(),
      betId,
      createdAt: new Date().toISOString(),
    });
    return id;
  }

  // Races: a round state machine driven by timers. Nothing runs until the first race call.
  let raceStarted = false;
  let round: MockRound | null = null;
  // The player's bet on the current round; at most one per round.
  let myBet: { betId: string; animal: number; stake: bigint; payout: bigint | null } | null = null;
  const raceBets = new Map<string, { request: RaceBetRequest; response: RaceBetResponse }>();
  const listeners = new Set<(event: RaceEvent) => void>();

  const emit = (event: RaceEvent) => {
    for (const listener of [...listeners]) listener(event);
  };

  function viewOf(r: MockRound): RaceRound {
    const base = {
      id: r.id,
      opensAt: new Date(r.opensAt).toISOString(),
      closesAt: new Date(r.closesAt).toISOString(),
      serverSeedHash: r.serverSeedHash,
    };
    if ((r.status === "resolved" || r.status === "settled") && r.result) {
      return {
        ...base,
        status: r.status,
        result: r.result,
        serverSeed: r.serverSeed,
        settlesAt: r.settlesAt ? new Date(r.settlesAt).toISOString() : undefined,
      };
    }
    return { ...base, status: r.status };
  }

  // The transition in flight (hashing and HMAC are async); race calls wait for it.
  let raceReady: Promise<void> = Promise.resolve();
  const schedule = (fn: () => Promise<void> | void, ms: number) =>
    setTimeout(() => {
      raceReady = Promise.resolve(fn());
    }, ms);

  /** Opens a round with the real derivation: the hash is published now, the result comes from the seed. */
  async function openRound() {
    const now = Date.now();
    const serverSeed = randomHex(32);
    const next: MockRound = {
      id: crypto.randomUUID(),
      status: "open",
      opensAt: now,
      closesAt: now + windowMs,
      settlesAt: null,
      serverSeed,
      serverSeedHash: await hashServerSeed(serverSeed),
      result: null,
    };
    round = next;
    myBet = null;
    emit({ type: "opened", round: viewOf(next) });
    schedule(closeRound, windowMs);
  }

  async function closeRound() {
    const current = round;
    if (!current) return;
    current.status = "closed";
    emit({ type: "closed", roundId: current.id });
    // Resolution is immediate, as in the backend worker.
    const result = resolveRace(
      createRng(await computeRoundOutcome(current.serverSeed, current.id)),
    );
    current.result = result;
    current.status = "resolved";
    current.settlesAt = Date.now() + durationMs;
    emit({ type: "result", roundId: current.id, result, serverSeed: current.serverSeed });
    schedule(settleRound, durationMs);
  }

  function settleRound() {
    const current = round;
    if (!current?.result) return;
    if (myBet) {
      const payout = myBet.animal === current.result.winner ? racePayout(myBet.stake) : 0n;
      myBet.payout = payout;
      if (payout > 0n) {
        balance += payout;
        record("payout", payout, myBet.betId);
      }
    }
    current.status = "settled";
    emit({ type: "settled", roundId: current.id });
    // Like the backend, the settled round stays current for the intermission, then the next opens.
    schedule(openRound, intermissionMs);
  }

  function ensureRaces() {
    if (raceStarted) return;
    raceStarted = true;
    if (startDelayMs > 0) schedule(openRound, startDelayMs);
    else raceReady = openRound();
  }

  return {
    async register(body: RegisterRequest) {
      await sleep(delayMs);
      const email = body.email.trim().toLowerCase();
      if (users.has(email)) {
        throw new ApiError("conflict", "An account with this email already exists", 409);
      }
      const id = crypto.randomUUID();
      users.set(email, { id, password: body.password });
      return session(id, email);
    },
    async login(body: LoginRequest) {
      await sleep(delayMs);
      const email = body.email.trim().toLowerCase();
      const user = users.get(email);
      if (!user || user.password !== body.password) {
        throw new ApiError("unauthorized", "Invalid email or password", 401);
      }
      return session(user.id, email);
    },
    async getBalance(): Promise<BalanceResponse> {
      await sleep(delayMs);
      return { balance: toAmount(balance) };
    },
    async deposit(body: DepositRequest, idempotencyKey: string): Promise<DepositResponse> {
      await sleep(delayMs);
      const previous = deposits.get(idempotencyKey);
      if (previous) return previous;
      const amount = parseAmount(body.amount);
      balance += amount;
      const response = {
        transactionId: record("deposit", amount, null),
        balance: toAmount(balance),
      };
      deposits.set(idempotencyKey, response);
      return response;
    },
    async listTransactions(
      query: TransactionHistoryQueryInput = {},
    ): Promise<TransactionHistoryResponse> {
      await sleep(delayMs);
      const limit = Number(query.limit ?? 20);
      const newestFirst = [...transactions].reverse();
      const after = query.cursor ? newestFirst.findIndex((t) => t.id === query.cursor) : -1;
      const items = newestFirst.slice(after + 1, after + 1 + limit);
      const last = items.at(-1);
      const hasMore = last !== undefined && after + 1 + limit < newestFirst.length;
      return { items, nextCursor: hasMore ? last.id : null };
    },
    async placeRouletteBet(
      body: RouletteBetRequest,
      idempotencyKey: string,
    ): Promise<RouletteBetResponse> {
      await sleep(delayMs);
      const previous = bets.get(idempotencyKey);
      if (previous) {
        // Same as the backend: a key reused with another list is refused, not replayed.
        if (!sameBets(previous.request.bets, body.bets)) {
          throw new ApiError(
            "conflict",
            "Idempotency-Key was already used for a different bet",
            409,
          );
        }
        return { ...previous.response, balance: toAmount(balance) };
      }
      const spin = body.bets.map(({ stake, selection }) => ({
        stake: parseAmount(stake),
        selection,
      }));
      if (!validateSpin(spin)) {
        throw new ApiError("invalid_request", "Invalid roulette bet", 400);
      }
      const stake = totalStake(spin);
      if (stake > balance) {
        throw new ApiError("insufficient_funds", "Insufficient funds", 422);
      }
      const seed = {
        serverSeed: crypto.randomUUID(),
        clientSeed: MOCK_CLIENT_SEED,
        nonce: bets.size,
      };
      const result = roulette.resolve(spin[0] ?? never(), createRng(await computeOutcome(seed)));
      const { payouts, total: payout } = spinPayouts(spin, result);
      const betId = crypto.randomUUID();
      balance -= stake;
      record("bet", -stake, betId);
      if (payout > 0n) {
        balance += payout;
        record("payout", payout, betId);
      }
      const response: RouletteBetResponse = {
        betId,
        result,
        bets: body.bets.map((item, i) => ({ ...item, payout: toAmount(payouts[i] ?? 0n) })),
        stake: toAmount(stake),
        payout: toAmount(payout),
        balance: toAmount(balance),
        fairness: {
          seedPairId: crypto.randomUUID(),
          serverSeedHash: await hashServerSeed(seed.serverSeed),
          clientSeed: seed.clientSeed,
          nonce: seed.nonce,
        },
      };
      bets.set(idempotencyKey, { request: body, response });
      return response;
    },
    async getCurrentRace(): Promise<CurrentRaceResponse> {
      ensureRaces();
      await raceReady;
      await sleep(delayMs);
      return {
        round: round ? viewOf(round) : null,
        myBet: myBet
          ? {
              animal: myBet.animal,
              stake: toAmount(myBet.stake),
              payout: myBet.payout === null ? null : toAmount(myBet.payout),
            }
          : null,
        now: new Date().toISOString(),
        limits: { minStake: toAmount(MIN_RACE_STAKE), maxStake: toAmount(MAX_RACE_STAKE) },
        raceDurationMs: durationMs,
      };
    },
    async placeRaceBet(body: RaceBetRequest, idempotencyKey: string): Promise<RaceBetResponse> {
      ensureRaces();
      await raceReady;
      await sleep(delayMs);
      const previous = raceBets.get(idempotencyKey);
      if (previous) {
        if (
          previous.request.roundId !== body.roundId ||
          previous.request.animal !== body.animal ||
          stakeAmount(previous.request.stake) !== stakeAmount(body.stake)
        ) {
          throw new ApiError(
            "conflict",
            "Idempotency-Key was already used for a different bet",
            409,
          );
        }
        return { ...previous.response, balance: toAmount(balance) };
      }
      const stake = stakeAmount(body.stake);
      if (
        stake === null ||
        stake < MIN_RACE_STAKE ||
        stake > MAX_RACE_STAKE ||
        !Number.isInteger(body.animal) ||
        body.animal < 0 ||
        body.animal > 4
      ) {
        throw new ApiError("invalid_request", "Invalid race bet", 400);
      }
      if (
        !round ||
        round.id !== body.roundId ||
        round.status !== "open" ||
        Date.now() >= round.closesAt
      ) {
        throw new ApiError("invalid_request", "The round is not open for bets", 400);
      }
      if (myBet) {
        throw new ApiError("conflict", "You already placed a bet in this round", 409);
      }
      if (stake > balance) {
        throw new ApiError("insufficient_funds", "Insufficient funds", 422);
      }
      const betId = crypto.randomUUID();
      balance -= stake;
      record("bet", -stake, betId);
      myBet = { betId, animal: body.animal, stake, payout: null };
      const response: RaceBetResponse = {
        betId,
        roundId: round.id,
        animal: body.animal,
        stake: toAmount(stake),
        balance: toAmount(balance),
      };
      raceBets.set(idempotencyKey, { request: body, response });
      return response;
    },
    watchRaces(onEvent, onStatus) {
      listeners.add(onEvent);
      ensureRaces();
      onStatus?.("connected");
      return () => {
        listeners.delete(onEvent);
      };
    },
    async getSeedPair() {
      await sleep(delayMs);
      return {
        id: seedPair.id,
        serverSeedHash: await hashServerSeed(seedPair.serverSeed),
        clientSeed: MOCK_CLIENT_SEED,
        nextNonce: seedPair.nextNonce,
      };
    },
    async startChickenRoadGame(body, idempotencyKey) {
      await sleep(delayMs);
      const parsed = chickenRoadStartRequestSchema.safeParse(body);
      if (!parsed.success) {
        throw new ApiError("invalid_request", "Stake must be between 10 and 500 credits", 400);
      }
      const stake = parseAmount(parsed.data.stake);

      // A retry returns the game as it is now, like the backend.
      const previous = chickenGames.find((g) => g.key === idempotencyKey);
      if (previous) {
        if (previous.stake !== stake) {
          throw conflict("Idempotency-Key was already used for a different stake");
        }
        const game = chickenView(previous);
        if (game.status !== "in_progress")
          throw conflict("This Chicken Road game already finished");
        return { game, balance: toAmount(balance) };
      }
      if (chickenGames.some((g) => g.payout === null)) {
        throw conflict("A Chicken Road game is already in progress");
      }
      if (stake > balance) throw new ApiError("insufficient_funds", "Insufficient funds", 422);

      const nonce = seedPair.nextNonce++;
      const seed = { serverSeed: seedPair.serverSeed, clientSeed: MOCK_CLIENT_SEED, nonce };
      const road = chickenRoad.resolve(
        { stake, cashOutAt: LANE_COUNT },
        createRng(await computeOutcome(seed)),
      );
      const game: MockChickenGame = {
        gameId: crypto.randomUUID(),
        key: idempotencyKey,
        stake,
        fairness: {
          seedPairId: seedPair.id,
          serverSeedHash: await hashServerSeed(seedPair.serverSeed),
          clientSeed: MOCK_CLIENT_SEED,
          nonce,
        },
        hitLane: fixedRoads.length > 0 ? (fixedRoads.shift() ?? null) : road.hitLane,
        lanes: 0,
        payout: null,
      };
      chickenGames.push(game);
      balance -= stake;
      record("bet", -stake, game.gameId);
      const view = chickenView(game);
      if (view.status !== "in_progress") throw new Error("a new game is in progress");
      return { game: view, balance: toAmount(balance) };
    },
    async stepChickenRoadGame(body) {
      await sleep(delayMs);
      const parsed = chickenRoadStepRequestSchema.safeParse(body);
      if (!parsed.success) throw new ApiError("invalid_request", "Invalid step", 400);
      const { gameId, lane } = parsed.data;
      const game = findChickenGame(gameId);

      // A lane already played replays the game as it is now.
      if (lane <= game.lanes) return chickenResponse(game);
      if (game.payout !== null) {
        throw conflict(
          game.payout === 0n
            ? "This Chicken Road game was lost"
            : "This Chicken Road game already finished",
        );
      }
      if (lane !== game.lanes + 1) throw conflict(`The next lane to cross is ${game.lanes + 1}`);

      game.lanes = lane;
      if (game.hitLane === lane) settleChicken(game, 0n);
      else if (lane === LANE_COUNT) settleChicken(game, chickenRoadPayout(game.stake, LANE_COUNT));
      return chickenResponse(game);
    },
    async cashOutChickenRoadGame(body) {
      await sleep(delayMs);
      const game = findChickenGame(body.gameId);
      const view = chickenView(game);
      if (view.status === "cashed_out" || view.status === "completed") {
        return { game: view, balance: toAmount(balance) };
      }
      if (view.status === "lost") throw conflict("This Chicken Road game was lost");
      if (game.lanes === 0) throw conflict("Cross at least one lane before cashing out");
      settleChicken(game, chickenRoadPayout(game.stake, game.lanes));
      const paid = chickenView(game);
      if (paid.status !== "cashed_out") throw new Error("a cashed-out game is paid");
      return { game: paid, balance: toAmount(balance) };
    },
    async getCurrentChickenRoadGame() {
      await sleep(delayMs);
      const game = chickenGames.find((g) => g.payout === null);
      const view = game ? chickenView(game) : null;
      return { game: view?.status === "in_progress" ? view : null };
    },
    async listChickenRoadHistory(query = {}) {
      await sleep(delayMs);
      const limit = query.limit ?? CHICKEN_ROAD_HISTORY_DEFAULT_LIMIT;
      if (!Number.isInteger(limit) || limit < 1 || limit > CHICKEN_ROAD_HISTORY_MAX_LIMIT) {
        throw new ApiError("invalid_request", "Invalid history limit", 400);
      }
      const games = [...chickenGames]
        .reverse()
        .filter((g) => g.payout !== null)
        .slice(0, limit)
        .map(chickenView)
        .flatMap((game) => (game.status === "in_progress" ? [] : [game]));
      return { games };
    },
  };
}
