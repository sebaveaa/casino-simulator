import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Db } from "../db/database";
import { createSimulatedPaymentProvider } from "../payments/simulated-payment-provider";
import { AppError } from "../platform/errors";
import { postgresTypes } from "../platform/postgres";
import { postgresWalletService as wallet } from "./postgres-wallet-service";
import { InsufficientFundsError, scopedKey } from "./wallet-service";

// Runs against a migrated database: `TEST_DATABASE_URL=... npm test` (see AGENTS.md). The
// ledger is append-only, so every test creates its own users instead of cleaning up.
describe.skipIf(!process.env.TEST_DATABASE_URL)("PostgresWalletService", () => {
  const payments = createSimulatedPaymentProvider(wallet);
  let pool: pg.Pool;
  let db: Db;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, types: postgresTypes });
    db = createDatabase(pool);
  });

  afterAll(async () => {
    await db.destroy();
  });

  async function createPlayer(balance = 0n): Promise<string> {
    const user = await db
      .insertInto("users")
      .values({ email: `${randomUUID()}@test.local`, password_hash: "not-a-real-hash" })
      .returning("id")
      .executeTakeFirstOrThrow();
    await wallet.createPlayerWallet(db, user.id);
    if (balance > 0n) await deposit(user.id, balance);
    return user.id;
  }

  function deposit(userId: string, amount: bigint, key = randomUUID()) {
    return db.transaction().execute((trx) =>
      payments.deposit(trx, {
        userId,
        amount,
        idempotencyKey: scopedKey("deposit", userId, key),
      }),
    );
  }

  /** One bet-shaped debit in its own transaction: lock first, then move the stake to the house. */
  function debit(userId: string, amount: bigint) {
    return db.transaction().execute(async (trx) => {
      await wallet.lockBalance(trx, userId);
      return wallet.transfer(trx, {
        from: { userId },
        to: "house",
        amount,
        type: "bet",
        idempotencyKey: scopedKey("roulette-bet", userId, randomUUID()),
      });
    });
  }

  async function entriesOf(transactionId: string) {
    return db
      .selectFrom("ledger_entries as e")
      .innerJoin("wallets as w", "w.id", "e.wallet_id")
      .select(["e.amount", "w.kind"])
      .where("e.transaction_id", "=", transactionId)
      .execute();
  }

  async function transactionCount(userId: string): Promise<number> {
    const rows = await db
      .selectFrom("ledger_entries as e")
      .innerJoin("wallets as w", "w.id", "e.wallet_id")
      .select("e.id")
      .where("w.user_id", "=", userId)
      .execute();
    return rows.length;
  }

  it("deposits from issuance with entries that sum to zero", async () => {
    const userId = await createPlayer();
    const { transactionId } = await deposit(userId, 500n);

    const entries = await entriesOf(transactionId);
    expect(entries).toHaveLength(2);
    expect(entries.reduce((sum, entry) => sum + entry.amount, 0n)).toBe(0n);
    expect(entries.find((entry) => entry.kind === "issuance")?.amount).toBe(-500n);
    expect(entries.find((entry) => entry.kind === "player")?.amount).toBe(500n);
    expect(await wallet.getBalance(db, userId)).toBe(500n);
  });

  it("debits a player to the house", async () => {
    const userId = await createPlayer(1000n);
    const { transactionId } = await debit(userId, 250n);

    expect(await wallet.getBalance(db, userId)).toBe(750n);
    const entries = await entriesOf(transactionId);
    expect(entries.find((entry) => entry.kind === "house")?.amount).toBe(250n);
    expect(entries.find((entry) => entry.kind === "player")?.amount).toBe(-250n);
  });

  it("rejects a debit above the balance and leaves it unchanged", async () => {
    const userId = await createPlayer(100n);

    await expect(debit(userId, 101n)).rejects.toBeInstanceOf(InsufficientFundsError);
    expect(await wallet.getBalance(db, userId)).toBe(100n);
    expect(await transactionCount(userId)).toBe(1);
  });

  it("rejects a non-positive amount", async () => {
    const userId = await createPlayer(100n);

    await expect(debit(userId, 0n)).rejects.toMatchObject({ code: "invalid_request" });
    await expect(debit(userId, -5n)).rejects.toMatchObject({ code: "invalid_request" });
    expect(await wallet.getBalance(db, userId)).toBe(100n);
  });

  it("never lets concurrent debits overspend a wallet", async () => {
    const userId = await createPlayer(100n);

    const results = await Promise.allSettled(Array.from({ length: 10 }, () => debit(userId, 30n)));

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(3);
    expect(rejected).toHaveLength(7);
    for (const result of rejected) {
      expect(result.reason).toBeInstanceOf(InsufficientFundsError);
    }
    expect(await wallet.getBalance(db, userId)).toBe(10n);
  });

  it("moves money once for a retried deposit key", async () => {
    const userId = await createPlayer();
    const key = randomUUID();

    const first = await deposit(userId, 300n, key);
    const second = await deposit(userId, 300n, key);

    expect(second.transactionId).toBe(first.transactionId);
    expect(await wallet.getBalance(db, userId)).toBe(300n);
    expect(await transactionCount(userId)).toBe(1);
  });

  it("moves money once for concurrent deposits with one key", async () => {
    const userId = await createPlayer();
    const key = randomUUID();

    const results = await Promise.all(Array.from({ length: 5 }, () => deposit(userId, 200n, key)));

    expect(new Set(results.map((result) => result.transactionId)).size).toBe(1);
    expect(await wallet.getBalance(db, userId)).toBe(200n);
    expect(await transactionCount(userId)).toBe(1);
  });

  it("finds a transaction by its idempotency key", async () => {
    const userId = await createPlayer();
    const key = randomUUID();
    const { transactionId } = await deposit(userId, 10n, key);

    expect(await wallet.findTransaction(db, scopedKey("deposit", userId, key))).toEqual({
      id: transactionId,
      betId: null,
    });
    expect(await wallet.findTransaction(db, scopedKey("deposit", userId, randomUUID()))).toBe(
      undefined,
    );
  });

  it("pages the history newest first with a cursor", async () => {
    const userId = await createPlayer();
    const ids: string[] = [];
    for (const amount of [10n, 20n, 30n, 40n, 50n]) {
      ids.push((await deposit(userId, amount)).transactionId);
    }
    await debit(userId, 5n);

    const first = await wallet.listTransactions(db, userId, { limit: 4 });
    expect(first.items).toHaveLength(4);
    expect(first.items[0]).toMatchObject({ type: "bet", amount: -5n });
    expect(first.nextCursor).not.toBeNull();

    const second = await wallet.listTransactions(db, userId, {
      limit: 4,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.items).toHaveLength(2);
    expect(second.nextCursor).toBeNull();

    const all = [...first.items, ...second.items];
    expect(all.slice(1).map((item) => item.id)).toEqual([...ids].reverse());
    expect(all.map((item) => item.amount)).toEqual([-5n, 50n, 40n, 30n, 20n, 10n]);
    for (let i = 1; i < all.length; i++) {
      const previous = all[i - 1];
      const current = all[i];
      expect(previous && current && previous.createdAt >= current.createdAt).toBe(true);
    }
  });

  it("rejects an invalid history cursor", async () => {
    const userId = await createPlayer();

    await expect(
      wallet.listTransactions(db, userId, { limit: 10, cursor: "not-a-cursor" }),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("throws not_found when the wallet is missing", async () => {
    const error = await wallet.getBalance(db, randomUUID()).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: "not_found" });
  });
});
