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
import type { ApiClient } from "./client";

const STARTING_BALANCE = 100000n;
const DEMO_EMAIL = "demo@casino.test";

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

  const session = (email: string): AuthResponse => ({
    token: "mock-token",
    user: { id: crypto.randomUUID(), email, role: "player" },
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
      return session(body.email);
    },
    async login(body: LoginRequest) {
      await sleep(delayMs);
      return session(body.email || DEMO_EMAIL);
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
