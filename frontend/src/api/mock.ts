import {
  type AuthResponse,
  type BalanceResponse,
  computeOutcome,
  createRng,
  type DepositRequest,
  type DepositResponse,
  hashServerSeed,
  type LoginRequest,
  parseAmount,
  type RegisterRequest,
  type RouletteBetRequest,
  type RouletteBetResponse,
  roulette,
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

function never(): never {
  throw new Error("A spin always has at least one bet");
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

/**
 * In-memory `ApiClient` for developing screens without a backend. Roulette spins run the shared
 * rules (`validateSpin`, `roulette.resolve`, `spinPayouts`) over a fixed mock seed pair, so payouts match
 * the real API; only the seeds and persistence are fake.
 */
export function createMockApiClient(options: { delayMs?: number } = {}): ApiClient {
  const delayMs = options.delayMs ?? 0;
  let balance = STARTING_BALANCE;
  const transactions: Transaction[] = [];
  const deposits = new Map<string, DepositResponse>();
  const bets = new Map<string, { request: RouletteBetRequest; response: RouletteBetResponse }>();

  // email -> account. Passwords are kept in plain text: this is a dev-only stand-in.
  const users = new Map<string, { id: string; password: string }>();

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
        if (JSON.stringify(previous.request) !== JSON.stringify(body)) {
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
  };
}
