import {
  type AuthResponse,
  type BalanceResponse,
  type DepositRequest,
  type DepositResponse,
  type LoginRequest,
  parseAmount,
  type RegisterRequest,
  type RouletteBetRequest,
  type RouletteBetResponse,
  type Transaction,
  type TransactionHistoryQueryInput,
  type TransactionHistoryResponse,
  toAmount,
} from "@casino/shared";
import { createUnsignedJwt } from "../session/jwt";
import { type ApiClient, ApiError } from "./client";

const STARTING_BALANCE = 100000n;
const TOKEN_LIFETIME_SECONDS = 3600;

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

/**
 * In-memory `ApiClient` for developing screens without a backend. It does not
 * implement game rules (#12 does): every roulette bet pays `"0"`.
 */
export function createMockApiClient(options: { delayMs?: number } = {}): ApiClient {
  const delayMs = options.delayMs ?? 0;
  let balance = STARTING_BALANCE;
  const transactions: Transaction[] = [];
  const deposits = new Map<string, DepositResponse>();
  const bets = new Map<string, RouletteBetResponse>();

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
      if (previous) return previous;
      const stake = parseAmount(body.stake);
      balance -= stake;
      const betId = crypto.randomUUID();
      record("bet", -stake, betId);
      const response: RouletteBetResponse = {
        betId,
        result: { number: Math.floor(Math.random() * 37) },
        payout: "0",
        balance: toAmount(balance),
        fairness: {
          seedPairId: crypto.randomUUID(),
          serverSeedHash: "0".repeat(64),
          clientSeed: "mock",
          nonce: bets.size,
        },
      };
      bets.set(idempotencyKey, response);
      return response;
    },
  };
}
