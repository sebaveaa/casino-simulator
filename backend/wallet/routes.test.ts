import { randomUUID } from "node:crypto";
import {
  apiPaths,
  balanceResponseSchema,
  depositResponseSchema,
  errorResponseSchema,
  type Money,
  transactionHistoryResponseSchema,
} from "@casino/shared";
import type { FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { type AuthUser, InvalidTokenError, type TokenService } from "../auth/token-service";
import { createDatabase, type Db } from "../db/database";
import { createSimulatedPaymentProvider } from "../payments/simulated-payment-provider";
import { buildApp } from "../platform/app";
import { postgresTypes } from "../platform/postgres";
import { stubServices } from "../platform/services";
import { postgresWalletService } from "./postgres-wallet-service";
import type { TransactionPage, TransactionRecord, WalletService } from "./wallet-service";

const config = {
  appEnv: "production" as const,
  allowedOrigins: [],
  raceDurationMs: 10_000,
  raceIntermissionMs: 8000,
  raceMinStake: 1n,
  raceMaxStake: 1000n,
};
const checks = { postgres: async () => true, redis: async () => true };

/** Treats the bearer token as the user id; tokens outside `known` are invalid. */
function fakeTokens(known: string[]): TokenService {
  return {
    sign: async () => "token",
    verify: async (token): Promise<AuthUser> => {
      if (!known.includes(token)) throw new InvalidTokenError();
      return { id: token, role: "player" };
    },
  };
}

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function authHeader(userId: string) {
  return { authorization: `Bearer ${userId}` };
}

function idempotency(key = randomUUID()) {
  return { "idempotency-key": key };
}

/** In-memory wallet: enough behavior for the route tests, no database. */
function fakeWallet() {
  const balances = new Map<string, Money>();
  const records: (TransactionRecord & { userId: string })[] = [];
  const keys = new Map<string, string>();
  let clock = 0;

  const wallet: WalletService = {
    createPlayerWallet: async (_db, userId) => void balances.set(userId, 0n),
    getBalance: async (_db, userId) => balances.get(userId) ?? 0n,
    lockBalance: async (_db, userId) => balances.get(userId) ?? 0n,
    transfer: async (_db, input) => {
      if (typeof input.to === "string") throw new Error("fake supports player credits only");
      const id = randomUUID();
      const userId = input.to.userId;
      balances.set(userId, (balances.get(userId) ?? 0n) + input.amount);
      keys.set(input.idempotencyKey, id);
      records.push({
        id,
        userId,
        type: input.type,
        amount: input.amount,
        betId: null,
        createdAt: new Date(Date.UTC(2026, 0, 1) + clock++ * 1000),
      });
      return { transactionId: id };
    },
    findTransaction: async (_db, key) => {
      const id = keys.get(key);
      return id ? { id, betId: null } : undefined;
    },
    // The cursor is the offset into the newest-first list.
    listTransactions: async (_db, userId, { limit, cursor }): Promise<TransactionPage> => {
      const mine = records.filter((r) => r.userId === userId).reverse();
      const start = cursor ? Number(cursor) : 0;
      const items = mine.slice(start, start + limit).map(({ userId: _owner, ...rest }) => rest);
      const next = start + limit;
      return { items, nextCursor: next < mine.length ? String(next) : null };
    },
  };
  return { wallet, records };
}

describe("wallet routes (in-memory wallet)", () => {
  const userId = "11111111-1111-4111-8111-111111111111";

  async function build() {
    const { wallet, records } = fakeWallet();
    await wallet.createPlayerWallet({} as Db, userId);
    // The fake wallet ignores the executor, so a transaction just runs its callback.
    const db = { transaction: () => ({ execute: (fn: (trx: Db) => unknown) => fn(db) }) } as Db;
    const app = await buildApp({
      config,
      checks,
      db,
      services: {
        ...stubServices,
        wallet,
        payments: createSimulatedPaymentProvider(wallet),
        tokens: fakeTokens([userId]),
      },
    });
    apps.push(app);
    return { app, records };
  }

  const deposit = (app: FastifyInstance, amount: string, headers: Record<string, string>) =>
    app.inject({
      method: "POST",
      url: apiPaths.deposits,
      headers: { ...authHeader(userId), ...headers },
      payload: { amount },
    });

  it("answers 401 without a valid token on every route", async () => {
    const { app } = await build();
    for (const [method, url] of [
      ["GET", apiPaths.balance],
      ["POST", apiPaths.deposits],
      ["GET", apiPaths.transactions],
    ] as const) {
      const missing = await app.inject({ method, url });
      expect(missing.statusCode).toBe(401);
      const forged = await app.inject({ method, url, headers: authHeader("nobody") });
      expect(forged.statusCode).toBe(401);
    }
  });

  it("returns the balance as a string", async () => {
    const { app } = await build();
    const res = await app.inject({
      method: "GET",
      url: apiPaths.balance,
      headers: authHeader(userId),
    });
    expect(res.statusCode).toBe(200);
    expect(balanceResponseSchema.parse(res.json())).toEqual({ balance: "0" });
  });

  it("credits a deposit and returns the new balance", async () => {
    const { app } = await build();
    const res = await deposit(app, "5000", idempotency());
    expect(res.statusCode).toBe(201);
    expect(depositResponseSchema.parse(res.json()).balance).toBe("5000");
  });

  it("returns the original result when a deposit is retried with the same key", async () => {
    const { app, records } = await build();
    const headers = idempotency();
    const first = depositResponseSchema.parse((await deposit(app, "5000", headers)).json());
    const retry = depositResponseSchema.parse((await deposit(app, "5000", headers)).json());
    expect(retry).toEqual(first);
    expect(records).toHaveLength(1);
  });

  it("rejects a deposit without an Idempotency-Key", async () => {
    const { app, records } = await build();
    const res = await deposit(app, "5000", {});
    expect(res.statusCode).toBe(400);
    expect(errorResponseSchema.parse(res.json()).error.code).toBe("invalid_request");
    expect(records).toHaveLength(0);
  });

  it.each(["0", "-5", "1.5", "abc", "9223372036854775808"])(
    "rejects the invalid amount %s",
    async (amount) => {
      const { app, records } = await build();
      const res = await deposit(app, amount, idempotency());
      expect(res.statusCode).toBe(400);
      expect(errorResponseSchema.parse(res.json()).error.code).toBe("invalid_request");
      expect(records).toHaveLength(0);
    },
  );

  it("lists the history newest first and pages with nextCursor", async () => {
    const { app } = await build();
    for (const amount of ["100", "200", "300"]) await deposit(app, amount, idempotency());
    const get = (query: string) =>
      app.inject({
        method: "GET",
        url: `${apiPaths.transactions}${query}`,
        headers: authHeader(userId),
      });

    const first = transactionHistoryResponseSchema.parse((await get("?limit=2")).json());
    expect(first.items.map((i) => i.amount)).toEqual(["300", "200"]);
    expect(first.items[0]?.type).toBe("deposit");
    expect(first.nextCursor).not.toBeNull();

    const second = transactionHistoryResponseSchema.parse(
      (await get(`?limit=2&cursor=${first.nextCursor}`)).json(),
    );
    expect(second.items.map((i) => i.amount)).toEqual(["100"]);
    expect(second.nextCursor).toBeNull();
  });

  it("rejects an out-of-range limit", async () => {
    const { app } = await build();
    const res = await app.inject({
      method: "GET",
      url: `${apiPaths.transactions}?limit=0`,
      headers: authHeader(userId),
    });
    expect(res.statusCode).toBe(400);
  });
});

// End to end against a migrated database: `TEST_DATABASE_URL=... npm test` (see AGENTS.md).
describe.skipIf(!process.env.TEST_DATABASE_URL)("wallet routes (PostgreSQL)", () => {
  let pool: pg.Pool;
  let db: Db;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, types: postgresTypes });
    db = createDatabase(pool);
  });

  afterAll(async () => {
    await db.destroy();
  });

  it("deposits once per key and lists the history newest first", async () => {
    const user = await db
      .insertInto("users")
      .values({ email: `${randomUUID()}@test.local`, password_hash: "not-a-real-hash" })
      .returning("id")
      .executeTakeFirstOrThrow();
    await postgresWalletService.createPlayerWallet(db, user.id);

    const app = await buildApp({
      config,
      checks,
      db,
      services: {
        ...stubServices,
        wallet: postgresWalletService,
        payments: createSimulatedPaymentProvider(postgresWalletService),
        tokens: fakeTokens([user.id]),
      },
    });
    apps.push(app);

    const deposit = (amount: string, headers: Record<string, string>) =>
      app.inject({
        method: "POST",
        url: apiPaths.deposits,
        headers: { ...authHeader(user.id), ...headers },
        payload: { amount },
      });

    const headers = idempotency();
    const first = depositResponseSchema.parse((await deposit("1000", headers)).json());
    const retry = depositResponseSchema.parse((await deposit("1000", headers)).json());
    expect(retry).toEqual(first);
    expect(first.balance).toBe("1000");
    await deposit("250", idempotency());

    const balance = await app.inject({
      method: "GET",
      url: apiPaths.balance,
      headers: authHeader(user.id),
    });
    expect(balanceResponseSchema.parse(balance.json())).toEqual({ balance: "1250" });

    const history = await app.inject({
      method: "GET",
      url: `${apiPaths.transactions}?limit=1`,
      headers: authHeader(user.id),
    });
    const page = transactionHistoryResponseSchema.parse(history.json());
    expect(page.items.map((i) => i.amount)).toEqual(["250"]);
    expect(page.nextCursor).not.toBeNull();

    const next = await app.inject({
      method: "GET",
      url: `${apiPaths.transactions}?limit=1&cursor=${page.nextCursor}`,
      headers: authHeader(user.id),
    });
    const second = transactionHistoryResponseSchema.parse(next.json());
    expect(second.items.map((i) => i.id)).toEqual([first.transactionId]);
    expect(second.nextCursor).toBeNull();
  });
});
