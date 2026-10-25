import { randomUUID } from "node:crypto";
import {
  type CrashResult,
  computeRoundOutcome,
  crashCashoutResponseSchema,
  crashPayout,
  createRng,
  hashServerSeed,
  resolveCrash,
} from "@casino/shared";
import type { Transaction } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Db } from "../../db/database";
import type { Database } from "../../db/schema";
import { postgresTypes } from "../../platform/postgres";
import { postgresWalletService as wallet } from "../../wallet/postgres-wallet-service";
import { scopedKey } from "../../wallet/wallet-service";
import { cashOutCrashBet } from "./cashout";
import { placeCrashBet } from "./place-bet";

class Rollback extends Error {}

const game = "dino-crash";
const STAKE = 1000n;
const limits = { min: 1000n, max: 50000n };

describe.skipIf(!process.env.TEST_DATABASE_URL)("cashOutCrashBet", () => {
  let pool: pg.Pool;
  let db: Db;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, types: postgresTypes });
    db = createDatabase(pool);
  });
  afterAll(async () => {
    await db.destroy();
  });

  async function rolledBack(fn: (trx: Transaction<Database>) => Promise<void>): Promise<void> {
    await db
      .transaction()
      .execute(async (trx) => {
        await fn(trx);
        throw new Rollback();
      })
      .catch((error) => {
        if (!(error instanceof Rollback)) throw error;
      });
  }

  async function createPlayer(trx: Db, balance: bigint): Promise<string> {
    const user = await trx
      .insertInto("users")
      .values({ email: `${randomUUID()}@test.local`, password_hash: "not-a-real-hash" })
      .returning("id")
      .executeTakeFirstOrThrow();
    await wallet.createPlayerWallet(trx, user.id);
    await wallet.transfer(trx, {
      from: "issuance",
      to: { userId: user.id },
      amount: balance,
      type: "deposit",
      idempotencyKey: scopedKey("deposit", user.id, randomUUID()),
    });
    return user.id;
  }

  /** A round whose impact point lands in `[crashMin, crashMax]`, so the timing is controllable. */
  async function controlledRound(crashMin: number, crashMax: number) {
    for (let i = 0; i < 200; i++) {
      const id = randomUUID();
      const seed = randomUUID() + randomUUID();
      const crash: CrashResult = resolveCrash(createRng(await computeRoundOutcome(seed, id)));
      if (crash.crashHundredths >= crashMin && crash.crashHundredths <= crashMax) {
        return { id, seed, crash };
      }
    }
    throw new Error("no round found in the target crash range");
  }

  /**
   * Creates a round and a placed bet, then moves `closes_at` into the past by `takeoffAgoMs` to
   * simulate takeoff (null leaves the round still accepting bets). Returns ids and the impact point.
   */
  async function setup(
    trx: Db,
    opts: { balance?: bigint; crashMin?: number; crashMax?: number; takeoffAgoMs: number | null },
  ) {
    const { balance = 10_000n, crashMin = 500, crashMax = 1999, takeoffAgoMs } = opts;
    const userId = await createPlayer(trx, balance);
    const { id, seed, crash } = await controlledRound(crashMin, crashMax);
    await trx
      .insertInto("game_rounds")
      .values({
        id,
        game,
        status: "open",
        server_seed: seed,
        server_seed_hash: await hashServerSeed(seed),
        opens_at: new Date(Date.now() - 5000),
        closes_at: new Date(Date.now() + 60_000),
      })
      .execute();
    const bet = await placeCrashBet(
      trx,
      { wallet },
      { userId, idempotencyKey: randomUUID(), roundId: id, game, stake: STAKE, limits },
    );
    if (takeoffAgoMs !== null) {
      await trx
        .updateTable("game_rounds")
        .set({
          status: "closed",
          opens_at: new Date(Date.now() - takeoffAgoMs - 5000),
          closes_at: new Date(Date.now() - takeoffAgoMs),
        })
        .where("id", "=", id)
        .execute();
    }
    return { userId, roundId: id, crash, betId: bet.betId };
  }

  const houseBalance = async (trx: Db) =>
    (
      await trx
        .selectFrom("wallets")
        .select("balance")
        .where("kind", "=", "house")
        .forUpdate()
        .executeTakeFirstOrThrow()
    ).balance;

  const payoutTxCount = async (trx: Db, userId: string, betId: string) =>
    Number(
      (
        await trx
          .selectFrom("transactions")
          .select((eb) => eb.fn.countAll().as("n"))
          .where("idempotency_key", "=", scopedKey("crash-payout", userId, betId))
          .executeTakeFirstOrThrow()
      ).n,
    );

  it("cashes out before the impact, paying the live multiplier, and the ledger balances", async () => {
    await rolledBack(async (trx) => {
      const { userId, crash, betId } = await setup(trx, { takeoffAgoMs: 1000 });
      const houseBefore = await houseBalance(trx);

      const res = await cashOutCrashBet(trx, { wallet }, { userId, game, betId });
      expect(crashCashoutResponseSchema.parse(res)).toEqual(res);

      const payout = crashPayout(STAKE, res.cashoutHundredths);
      expect(res.cashoutHundredths).toBeGreaterThanOrEqual(100);
      expect(res.cashoutHundredths).toBeLessThan(crash.crashHundredths);
      expect(BigInt(res.payout)).toBe(payout);
      expect(payout).toBeGreaterThanOrEqual(STAKE);

      // Debited the stake, then credited the payout: net = payout - stake.
      expect(await wallet.getBalance(trx, userId)).toBe(10_000n - STAKE + payout);
      expect(res.balance).toBe((10_000n - STAKE + payout).toString());
      // `houseBefore` already holds the staked credits (the bet ran in setup); the cash-out only
      // moves `payout` back out, so the house loses exactly the payout. The ledger nets to zero.
      expect(await houseBalance(trx)).toBe(houseBefore - payout);

      const stored = await trx
        .selectFrom("bets")
        .select(["status", "payout", "result", "actions"])
        .where("id", "=", betId)
        .executeTakeFirstOrThrow();
      expect(stored.status).toBe("settled");
      expect(stored.payout).toBe(payout);
      expect(stored.result).toEqual({ outcome: "cashout", atHundredths: res.cashoutHundredths });
      expect(stored.actions).toMatchObject({
        type: "cashout",
        atHundredths: res.cashoutHundredths,
      });
    });
  });

  it("pays once on a double cash-out", async () => {
    await rolledBack(async (trx) => {
      const { userId, betId } = await setup(trx, { takeoffAgoMs: 1000 });
      const first = await cashOutCrashBet(trx, { wallet }, { userId, game, betId });
      const second = await cashOutCrashBet(trx, { wallet }, { userId, game, betId });
      expect(second.cashoutHundredths).toBe(first.cashoutHundredths);
      expect(second.payout).toBe(first.payout);
      expect(await payoutTxCount(trx, userId, betId)).toBe(1);
      expect(await wallet.getBalance(trx, userId)).toBe(10_000n - STAKE + BigInt(first.payout));
    });
  });

  it("rejects a cash-out after the impact, leaving the bet pending", async () => {
    await rolledBack(async (trx) => {
      const { userId, betId } = await setup(trx, { takeoffAgoMs: 120_000 });
      await expect(cashOutCrashBet(trx, { wallet }, { userId, game, betId })).rejects.toMatchObject(
        {
          code: "invalid_request",
        },
      );
      const bet = await trx
        .selectFrom("bets")
        .select("status")
        .where("id", "=", betId)
        .executeTakeFirstOrThrow();
      expect(bet.status).toBe("pending");
      expect(await wallet.getBalance(trx, userId)).toBe(10_000n - STAKE);
    });
  });

  it("rejects a cash-out before takeoff", async () => {
    await rolledBack(async (trx) => {
      const { userId, betId } = await setup(trx, { takeoffAgoMs: null });
      await expect(cashOutCrashBet(trx, { wallet }, { userId, game, betId })).rejects.toMatchObject(
        {
          code: "invalid_request",
        },
      );
    });
  });

  it("rejects a cash-out on a bet already settled as a loss", async () => {
    await rolledBack(async (trx) => {
      const { userId, betId } = await setup(trx, { takeoffAgoMs: 1000 });
      await trx
        .updateTable("bets")
        .set({
          status: "settled",
          payout: 0n,
          settled_at: new Date(),
          result: JSON.stringify({ outcome: "lost" }),
        })
        .where("id", "=", betId)
        .execute();
      await expect(cashOutCrashBet(trx, { wallet }, { userId, game, betId })).rejects.toMatchObject(
        {
          code: "invalid_request",
        },
      );
      expect(await wallet.getBalance(trx, userId)).toBe(10_000n - STAKE);
    });
  });

  it("answers not_found for an unknown bet", async () => {
    await rolledBack(async (trx) => {
      const userId = await createPlayer(trx, 10_000n);
      await expect(
        cashOutCrashBet(trx, { wallet }, { userId, game, betId: randomUUID() }),
      ).rejects.toMatchObject({ code: "not_found" });
    });
  });
});
