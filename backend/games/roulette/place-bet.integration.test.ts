import { randomUUID } from "node:crypto";
import {
  computeOutcome,
  createRng,
  type RouletteBet,
  roulette,
  rouletteBetResponseSchema,
  spinPayouts,
  totalStake,
} from "@casino/shared";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Db } from "../../db/database";
import { AppError } from "../../platform/errors";
import { postgresTypes } from "../../platform/postgres";
import { postgresSeedPairService as seedPairs } from "../../rng/postgres-seed-pair-service";
import { postgresWalletService as wallet } from "../../wallet/postgres-wallet-service";
import { InsufficientFundsError, scopedKey } from "../../wallet/wallet-service";
import { placeRouletteBet } from "./place-bet";

// Runs against a migrated database: `TEST_DATABASE_URL=... npm test` (see AGENTS.md). The
// ledger is append-only, so every test creates its own user instead of cleaning up.
describe.skipIf(!process.env.TEST_DATABASE_URL)("placeRouletteBet", () => {
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
    if (balance > 0n) await credit(user.id, balance, randomUUID());
    return user.id;
  }

  function credit(userId: string, amount: bigint, key: string, purpose = "deposit") {
    return db.transaction().execute((trx) =>
      wallet.transfer(trx, {
        from: "issuance",
        to: { userId },
        amount,
        type: "deposit",
        idempotencyKey: scopedKey(purpose, userId, key),
      }),
    );
  }

  const place = (userId: string, bets: RouletteBet[], key = randomUUID()) =>
    db
      .transaction()
      .execute((trx) =>
        placeRouletteBet(trx, { wallet, seedPairs }, { userId, idempotencyKey: key, bets }),
      );

  const red: RouletteBet = { stake: 100n, selection: { type: "color", color: "red" } };
  const straight17: RouletteBet = { stake: 20n, selection: { type: "straight", number: 17 } };
  const dozen2: RouletteBet = { stake: 30n, selection: { type: "dozen", dozen: 2 } };
  const multi = [red, straight17, dozen2];

  const countBets = async (userId: string) =>
    Number(
      (
        await db
          .selectFrom("bets")
          .select((eb) => eb.fn.countAll().as("n"))
          .where("user_id", "=", userId)
          .executeTakeFirstOrThrow()
      ).n,
    );

  it("settles a bet: the response, the stored bet and the ledger agree", async () => {
    const userId = await createPlayer(1000n);
    const res = await place(userId, [red]);
    expect(rouletteBetResponseSchema.parse(res)).toEqual(res);

    const expectedPayout = roulette.payout(red, res.result);
    const expectedBalance = 1000n - 100n + expectedPayout;
    expect(res.payout).toBe(expectedPayout.toString());
    expect(res.balance).toBe(expectedBalance.toString());
    expect(await wallet.getBalance(db, userId)).toBe(expectedBalance);

    const stored = await db
      .selectFrom("bets as b")
      .innerJoin("seed_pairs as s", "s.id", "b.seed_pair_id")
      .select(["b.status", "b.stake", "b.payout", "b.nonce", "b.settled_at", "s.server_seed"])
      .where("b.id", "=", res.betId)
      .executeTakeFirstOrThrow();
    expect(stored).toMatchObject({ status: "settled", stake: 100n, payout: expectedPayout });
    expect(stored.settled_at).not.toBeNull();
    expect(stored.nonce).toBe(res.fairness.nonce);

    // Anyone holding the (later revealed) server seed recomputes the same pocket (README §5).
    const outcome = await computeOutcome({
      serverSeed: stored.server_seed,
      clientSeed: res.fairness.clientSeed,
      nonce: res.fairness.nonce,
    });
    expect(roulette.resolve(red, createRng(outcome))).toEqual(res.result);
    expect(res.stake).toBe("100");
    expect(res.bets).toEqual([
      { stake: "100", selection: red.selection, payout: expectedPayout.toString() },
    ]);

    const types = await db
      .selectFrom("transactions")
      .select("type")
      .where("bet_id", "=", res.betId)
      .orderBy("type")
      .execute();
    expect(types.map((t) => t.type)).toEqual(expectedPayout > 0n ? ["bet", "payout"] : ["bet"]);
  });

  it("keeps the ledger consistent over wins and losses, and the nonce advances", async () => {
    const userId = await createPlayer(100_000n);
    const nonces: number[] = [];
    const outcomes = new Set<boolean>();
    let expected = 100_000n;
    for (let i = 0; i < 40; i++) {
      const res = await place(userId, [red]);
      const payout = BigInt(res.payout);
      expected += payout - red.stake;
      outcomes.add(payout > 0n);
      nonces.push(res.fairness.nonce);
      expect(res.balance).toBe(expected.toString());
    }
    const first = nonces[0] ?? -1;
    expect(nonces).toEqual(Array.from({ length: 40 }, (_, i) => first + i));
    // 40 coin flips missing one side has a probability of about 1e-12.
    expect(outcomes).toEqual(new Set([true, false]));
    expect(await wallet.getBalance(db, userId)).toBe(expected);
  });

  it("rejects a bet the player cannot afford without a trace", async () => {
    const userId = await createPlayer(50n);
    await expect(place(userId, [red])).rejects.toBeInstanceOf(InsufficientFundsError);
    expect(await wallet.getBalance(db, userId)).toBe(50n);
    expect(await countBets(userId)).toBe(0);
    expect((await seedPairs.getActive(db, userId)).nextNonce).toBe(0);
  });

  it("charges once when the same key is retried, and replays the original body", async () => {
    const userId = await createPlayer(1000n);
    const key = randomUUID();
    const first = await place(userId, [red], key);
    const retry = await place(userId, [red], key);
    expect(retry).toEqual(first);
    expect(await countBets(userId)).toBe(1);
    expect(await wallet.getBalance(db, userId)).toBe(BigInt(first.balance));
    expect((await seedPairs.getActive(db, userId)).nextNonce).toBe(1);
  });

  it("charges once when the same key arrives concurrently", async () => {
    const userId = await createPlayer(1000n);
    const key = randomUUID();
    const results = await Promise.all([1, 2, 3, 4].map(() => place(userId, [red], key)));
    expect(new Set(results.map((r) => r.betId)).size).toBe(1);
    expect(await countBets(userId)).toBe(1);
    expect((await seedPairs.getActive(db, userId)).nextNonce).toBe(1);
    expect(await wallet.getBalance(db, userId)).toBe(
      1000n - 100n + BigInt(results[0]?.payout ?? "0"),
    );
  });

  it("refuses a key reused with a different stake or selection", async () => {
    const userId = await createPlayer(1000n);
    const key = randomUUID();
    const first = await place(userId, [red], key);
    for (const changed of [
      [{ ...red, stake: 200n }],
      [{ ...red, selection: { type: "color", color: "black" } }],
      [{ ...red, selection: { type: "straight", number: 7 } }],
      [red, straight17],
    ] satisfies RouletteBet[][]) {
      await expect(place(userId, changed, key)).rejects.toMatchObject({ code: "conflict" });
    }
    expect(await countBets(userId)).toBe(1);
    expect(await wallet.getBalance(db, userId)).toBe(BigInt(first.balance));
    // The original request still replays.
    expect(await place(userId, [red], key)).toEqual(first);
  });

  it("settles a spin with several selections as one bet, one nonce and balanced entries", async () => {
    const userId = await createPlayer(1000n);
    const res = await place(userId, multi);
    expect(rouletteBetResponseSchema.parse(res)).toEqual(res);

    const { payouts, total } = spinPayouts(multi, res.result);
    expect(res.stake).toBe("150");
    expect(res.payout).toBe(total.toString());
    expect(res.bets.map((b) => b.payout)).toEqual(payouts.map(String));
    expect(res.bets.map((b) => b.stake)).toEqual(["100", "20", "30"]);
    const expectedBalance = 1000n - totalStake(multi) + total;
    expect(res.balance).toBe(expectedBalance.toString());
    expect(await wallet.getBalance(db, userId)).toBe(expectedBalance);

    expect(await countBets(userId)).toBe(1);
    expect((await seedPairs.getActive(db, userId)).nextNonce).toBe(1);
    const stored = await db
      .selectFrom("bets")
      .select(["stake", "payout", "selection", "result"])
      .where("id", "=", res.betId)
      .executeTakeFirstOrThrow();
    expect(stored).toMatchObject({ stake: 150n, payout: total, result: res.result });
    expect(stored.selection).toEqual([
      { stake: "100", selection: red.selection },
      { stake: "20", selection: straight17.selection },
      { stake: "30", selection: dozen2.selection },
    ]);

    // Double entry: the entries of each transaction of the spin sum to zero.
    const entries = await db
      .selectFrom("ledger_entries as e")
      .innerJoin("transactions as t", "t.id", "e.transaction_id")
      .select(["t.id", "t.type", "e.amount"])
      .where("t.bet_id", "=", res.betId)
      .execute();
    const sums = new Map<string, bigint>();
    for (const e of entries) sums.set(e.id, (sums.get(e.id) ?? 0n) + e.amount);
    expect(sums.size).toBe(total > 0n ? 2 : 1);
    for (const sum of sums.values()) expect(sum).toBe(0n);
  });

  it("rejects a spin whose total stake is out of reach, without burning a nonce", async () => {
    // Each selection is affordable alone; the three together are not.
    const userId = await createPlayer(120n);
    await expect(place(userId, multi)).rejects.toBeInstanceOf(InsufficientFundsError);
    expect(await wallet.getBalance(db, userId)).toBe(120n);
    expect(await countBets(userId)).toBe(0);
    expect((await seedPairs.getActive(db, userId)).nextNonce).toBe(0);
  });

  it("charges a multi-selection spin once when the same key is retried", async () => {
    const userId = await createPlayer(1000n);
    const key = randomUUID();
    const first = await place(userId, multi, key);
    const retry = await place(userId, multi, key);
    expect(retry).toEqual(first);
    expect(await countBets(userId)).toBe(1);
    expect(await wallet.getBalance(db, userId)).toBe(BigInt(first.balance));
  });

  it("refuses a key reused with the same selections reordered or restaked", async () => {
    const userId = await createPlayer(1000n);
    const key = randomUUID();
    const first = await place(userId, multi, key);
    const reordered = [straight17, red, dozen2];
    const restaked = [red, { ...straight17, stake: 21n }, dozen2];
    for (const changed of [reordered, restaked, [red, straight17]]) {
      await expect(place(userId, changed, key)).rejects.toMatchObject({ code: "conflict" });
    }
    expect(await countBets(userId)).toBe(1);
    expect(await place(userId, multi, key)).toEqual(first);
  });

  it("scopes a key to its player", async () => {
    const a = await createPlayer(1000n);
    const b = await createPlayer(1000n);
    const key = randomUUID();
    const first = await place(a, [red], key);
    const other = await place(b, [red], key);
    expect(other.betId).not.toBe(first.betId);
    expect(await countBets(b)).toBe(1);
  });

  it("refuses a key whose transaction is not a roulette bet", async () => {
    const userId = await createPlayer(1000n);
    const key = randomUUID();
    await credit(userId, 10n, key, "roulette-bet");
    await expect(place(userId, [red], key)).rejects.toBeInstanceOf(AppError);
    expect(await countBets(userId)).toBe(0);
  });
});
