import { randomUUID } from "node:crypto";
import {
  type BlackjackAction,
  type BlackjackHandState,
  blackjackActionResponseSchema,
  blackjackPayout,
  blackjackStartResponseSchema,
  computeOutcome,
  createRng,
  describeCard,
  legalActions,
  playHand,
  shuffleShoe,
} from "@casino/shared";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Db } from "../../db/database";
import { AppError } from "../../platform/errors";
import { postgresTypes } from "../../platform/postgres";
import { postgresSeedPairService as seedPairs } from "../../rng/postgres-seed-pair-service";
import { postgresWalletService as wallet } from "../../wallet/postgres-wallet-service";
import { InsufficientFundsError, scopedKey } from "../../wallet/wallet-service";
import { BLACKJACK_ABANDON_MS, settleAbandonedHand } from "./expiry";
import { actOnBlackjackHand, startBlackjackHand } from "./game";
import { getCurrentBlackjackHand, listBlackjackHistory } from "./view";

// Runs against a migrated database: `TEST_DATABASE_URL=... npm test` (see AGENTS.md). The
// ledger is append-only, so every test creates its own user instead of cleaning up.
describe.skipIf(!process.env.TEST_DATABASE_URL)("Blackjack hands", () => {
  let pool: pg.Pool;
  let db: Db;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, types: postgresTypes });
    db = createDatabase(pool);
  });

  afterAll(async () => {
    await db.destroy();
  });

  const STAKE = 1000n;
  const FUNDS = 1_000_000n;

  async function createPlayer(balance = FUNDS): Promise<string> {
    const user = await db
      .insertInto("users")
      .values({ email: `${randomUUID()}@test.local`, password_hash: "not-a-real-hash" })
      .returning("id")
      .executeTakeFirstOrThrow();
    await wallet.createPlayerWallet(db, user.id);
    if (balance > 0n) {
      await db.transaction().execute((trx) =>
        wallet.transfer(trx, {
          from: "issuance",
          to: { userId: user.id },
          amount: balance,
          type: "deposit",
          idempotencyKey: scopedKey("deposit", user.id, randomUUID()),
        }),
      );
    }
    return user.id;
  }

  const start = (userId: string, key = randomUUID(), stake = STAKE) =>
    db
      .transaction()
      .execute((trx) =>
        startBlackjackHand(trx, { wallet, seedPairs }, { userId, idempotencyKey: key, stake }),
      );
  const act = (userId: string, handId: string, action: BlackjackAction, index: number) =>
    db
      .transaction()
      .execute((trx) => actOnBlackjackHand(trx, { wallet }, { userId, handId, action, index }));
  const settleAbandoned = (userId: string) =>
    db.transaction().execute((trx) => settleAbandonedHand(trx, { wallet }, userId));

  /** The shoe computed apart from the code under test, from the stored seed. */
  async function shoeOf(handId: string): Promise<number[]> {
    const row = await db
      .selectFrom("bets as b")
      .innerJoin("seed_pairs as s", "s.id", "b.seed_pair_id")
      .select(["b.nonce", "s.server_seed", "s.client_seed"])
      .where("b.id", "=", handId)
      .executeTakeFirstOrThrow();
    const outcome = await computeOutcome({
      serverSeed: row.server_seed,
      clientSeed: row.client_seed,
      nonce: row.nonce ?? -1,
    });
    return shuffleShoe(createRng(outcome));
  }

  /** Stands until the hand is settled, so the next start is allowed. */
  async function playOut(userId: string, handId: string): Promise<void> {
    const { hand } = await act(userId, handId, "stand", 0);
    expect(hand.status).toBe("settled");
  }

  /**
   * Starts hands until one has a shoe that fits: seeds are random, so the test picks the cards
   * instead of hard-coding a seed. Hands that do not fit are played out.
   */
  async function startWithShoe(userId: string, fits: (shoe: number[]) => boolean) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const key = randomUUID();
      const res = await start(userId, key);
      const shoe = await shoeOf(res.hand.handId);
      if (fits(shoe)) return { ...res, key, shoe };
      if (res.hand.status === "player_turn") await playOut(userId, res.hand.handId);
    }
    throw new Error("no shoe fit in 100 hands");
  }

  /** A shoe whose hand waits for the player and lets `actions` play out. */
  const opensWith =
    (actions: BlackjackAction[], fits: (state: BlackjackHandState) => boolean = () => true) =>
    (shoe: number[]) => {
      if (playHand(shoe, []).outcome !== null) return false;
      try {
        return fits(playHand(shoe, actions));
      } catch {
        return false;
      }
    };

  async function payoutCount(handId: string): Promise<number> {
    const rows = await db
      .selectFrom("transactions")
      .select("id")
      .where("bet_id", "=", handId)
      .where("type", "=", "payout")
      .execute();
    return rows.length;
  }

  /** The cached balance equals the sum of the player's ledger entries. */
  async function expectLedgerMatches(userId: string): Promise<void> {
    const { sum } = await db
      .selectFrom("ledger_entries as e")
      .innerJoin("wallets as w", "w.id", "e.wallet_id")
      .select(sql<string>`coalesce(sum(e.amount), 0)::text`.as("sum"))
      .where("w.user_id", "=", userId)
      .executeTakeFirstOrThrow();
    expect(BigInt(sum)).toBe(await wallet.getBalance(db, userId));
  }

  /** Moves the hand's start and every action timestamp `ms` into the past. */
  async function age(handId: string, ms: number): Promise<void> {
    const row = await db
      .selectFrom("bets")
      .select(["created_at", "actions"])
      .where("id", "=", handId)
      .executeTakeFirstOrThrow();
    const actions = (row.actions as { action: string; at: string }[]).map((a) => ({
      action: a.action,
      at: new Date(new Date(a.at).getTime() - ms).toISOString(),
    }));
    // Raw SQL: the schema types forbid updating `created_at`, which only tests rewrite.
    await sql`update bets set created_at = ${new Date(row.created_at.getTime() - ms)},
      actions = ${JSON.stringify(actions)}::jsonb where id = ${handId}`.execute(db);
  }

  describe("start", () => {
    it("charges the stake and deals from the shoe of the seed", async () => {
      const userId = await createPlayer();
      const res = await startWithShoe(userId, opensWith([]));
      expect(blackjackStartResponseSchema.safeParse(res).success).toBe(true);
      expect(res.hand).toMatchObject({
        status: "player_turn",
        stake: "1000",
        actionCount: 0,
        canDouble: true,
      });
      const state = playHand(res.shoe, []);
      expect(res.hand.playerCards).toEqual(state.playerCards.map(describeCard));
      if (res.hand.status !== "player_turn") throw new Error("expected a hand in progress");
      expect(res.hand.dealerUpCard).toEqual(describeCard(state.dealerCards[0] as number));

      const stored = await db
        .selectFrom("bets")
        .select(["status", "stake", "payout", "result"])
        .where("id", "=", res.hand.handId)
        .executeTakeFirstOrThrow();
      expect(stored).toMatchObject({ status: "in_progress", stake: STAKE, payout: null });
      // The shoe is not stored while the hand runs (README §4.4).
      expect(stored.result).toBeNull();
      await expectLedgerMatches(userId);
    });

    it("settles a natural at once and pays it once", async () => {
      const userId = await createPlayer();
      const res = await startWithShoe(userId, (shoe) => playHand(shoe, []).outcome !== null);
      if (res.hand.status !== "settled") throw new Error("expected a settled hand");
      const state = playHand(res.shoe, []);
      expect(res.hand.outcome).toBe(state.outcome);
      const payout = blackjackPayout(STAKE, { doubled: false, outcome: res.hand.outcome });
      expect(res.hand.payout).toBe(payout.toString());
      expect(await payoutCount(res.hand.handId)).toBe(payout > 0n ? 1 : 0);
      await expectLedgerMatches(userId);
    });

    it("replays a retried start with the current hand and charges once", async () => {
      const userId = await createPlayer();
      const res = await startWithShoe(
        userId,
        opensWith(["hit"], (s) => s.outcome === null),
      );
      await act(userId, res.hand.handId, "hit", 0);

      const retry = await start(userId, res.key);
      expect(retry.hand).toMatchObject({ handId: res.hand.handId, actionCount: 1 });
      expect(retry.balance).toBe(res.balance);
      await expect(start(userId, res.key, 2000n)).rejects.toMatchObject({ code: "conflict" });
      await expectLedgerMatches(userId);
    });

    it("allows one hand in progress per player", async () => {
      const userId = await createPlayer();
      await startWithShoe(userId, opensWith([]));
      await expect(start(userId)).rejects.toMatchObject({ code: "conflict" });
    });

    it("refuses a stake above the balance without burning a nonce", async () => {
      const userId = await createPlayer(STAKE - 1n);
      const before = await seedPairs.getActive(db, userId);
      await expect(start(userId)).rejects.toBeInstanceOf(InsufficientFundsError);
      expect((await seedPairs.getActive(db, userId)).nextNonce).toBe(before.nextNonce);
    });

    it("refuses stakes outside 10 to 500 credits", async () => {
      const userId = await createPlayer();
      await expect(start(userId, randomUUID(), 999n)).rejects.toMatchObject({
        code: "invalid_request",
      });
    });
  });

  describe("actions", () => {
    it("stands, lets the dealer draw and pays as the rules say", async () => {
      const userId = await createPlayer();
      const res = await startWithShoe(userId, opensWith([]));
      const { hand, balance } = await act(userId, res.hand.handId, "stand", 0);
      expect(blackjackActionResponseSchema.parse({ hand, balance })).toBeTruthy();
      if (hand.status !== "settled") throw new Error("expected a settled hand");

      const state = playHand(res.shoe, ["stand"]);
      expect(hand.dealerCards).toEqual(state.dealerCards.map(describeCard));
      expect(hand.outcome).toBe(state.outcome);
      const payout = blackjackPayout(STAKE, { doubled: false, outcome: hand.outcome });
      expect(hand).toMatchObject({ totalStake: "1000", payout: payout.toString() });
      expect(balance).toBe((FUNDS - STAKE + payout).toString());
      await expectLedgerMatches(userId);
    });

    it("hits and keeps the turn open under 21", async () => {
      const userId = await createPlayer();
      const res = await startWithShoe(
        userId,
        opensWith(["hit"], (s) => s.outcome === null),
      );
      const { hand } = await act(userId, res.hand.handId, "hit", 0);
      expect(hand).toMatchObject({ status: "player_turn", actionCount: 1, canDouble: false });
      expect(hand.playerCards).toHaveLength(3);
      await expect(act(userId, res.hand.handId, "double", 1)).rejects.toMatchObject({
        code: "conflict",
      });
    });

    it("replays an index already played and refuses a different action or a skipped index", async () => {
      const userId = await createPlayer();
      const res = await startWithShoe(
        userId,
        opensWith(["hit"], (s) => s.outcome === null),
      );
      const first = await act(userId, res.hand.handId, "hit", 0);
      expect(await act(userId, res.hand.handId, "hit", 0)).toEqual(first);
      await expect(act(userId, res.hand.handId, "stand", 0)).rejects.toMatchObject({
        code: "conflict",
      });
      await expect(act(userId, res.hand.handId, "stand", 2)).rejects.toMatchObject({
        code: "conflict",
      });
    });

    it("refuses any new action once the hand is settled", async () => {
      const userId = await createPlayer();
      const res = await startWithShoe(userId, opensWith([]));
      await act(userId, res.hand.handId, "stand", 0);
      await expect(act(userId, res.hand.handId, "hit", 1)).rejects.toMatchObject({
        code: "conflict",
      });
    });

    it("doubles: charges the stake again once and pays on the doubled total", async () => {
      const userId = await createPlayer();
      const res = await startWithShoe(userId, opensWith(["double"]));
      const { hand, balance } = await act(userId, res.hand.handId, "double", 0);
      if (hand.status !== "settled") throw new Error("expected a settled hand");

      const state = playHand(res.shoe, ["double"]);
      expect(hand).toMatchObject({ doubled: true, stake: "1000", totalStake: "2000" });
      expect(hand.playerCards).toEqual(state.playerCards.map(describeCard));
      const payout = blackjackPayout(STAKE, { doubled: true, outcome: hand.outcome });
      expect(hand.outcome).toBe(state.outcome);
      expect(hand.payout).toBe(payout.toString());
      expect(balance).toBe((FUNDS - 2n * STAKE + payout).toString());

      expect(await act(userId, res.hand.handId, "double", 0)).toEqual({ hand, balance });
      await expectLedgerMatches(userId);
    });

    it("refuses to double without the funds and leaves the hand as it was", async () => {
      const userId = await createPlayer();
      const res = await startWithShoe(userId, opensWith([]));
      // Withdraw all but half a stake, so the second stake no longer fits.
      const drain = (await wallet.getBalance(db, userId)) - STAKE / 2n;
      await db.transaction().execute((trx) =>
        wallet.transfer(trx, {
          from: { userId },
          to: "issuance",
          amount: drain,
          type: "withdrawal",
          idempotencyKey: scopedKey("withdrawal", userId, randomUUID()),
        }),
      );
      await expect(act(userId, res.hand.handId, "double", 0)).rejects.toBeInstanceOf(
        InsufficientFundsError,
      );
      expect(await getCurrentBlackjackHand(db, userId)).toEqual(res.hand);
      const { hand } = await act(userId, res.hand.handId, "stand", 0);
      expect(hand.status).toBe("settled");
      await expectLedgerMatches(userId);
    });

    it("pays once when two stands race", async () => {
      const userId = await createPlayer();
      const res = await startWithShoe(
        userId,
        opensWith(["stand"], (s) => s.outcome !== "lose"),
      );
      const [a, b] = await Promise.all([
        act(userId, res.hand.handId, "stand", 0),
        act(userId, res.hand.handId, "stand", 0),
      ]);
      expect(a).toEqual(b);
      expect(await payoutCount(res.hand.handId)).toBe(1);
      await expectLedgerMatches(userId);
    });

    it("does not find another player's hand", async () => {
      const owner = await createPlayer();
      const other = await createPlayer();
      const res = await startWithShoe(owner, opensWith([]));
      const error = await act(other, res.hand.handId, "stand", 0).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({ code: "not_found" });
    });
  });

  describe("abandonment", () => {
    it("stands for the player after 10 minutes and pays with the normal rules", async () => {
      const userId = await createPlayer();
      const res = await startWithShoe(
        userId,
        opensWith(["hit"], (s) => s.outcome === null),
      );
      await act(userId, res.hand.handId, "hit", 0);

      await age(res.hand.handId, BLACKJACK_ABANDON_MS - 60_000);
      expect(await settleAbandoned(userId)).toBe(false);

      await age(res.hand.handId, 60_000);
      expect(await settleAbandoned(userId)).toBe(true);
      expect(await getCurrentBlackjackHand(db, userId)).toBeNull();

      // Looked up by id: aging the hand moved it behind the hands played out to find its shoe.
      const history = await listBlackjackHistory(db, userId, 20);
      const hand = history.find((h) => h.handId === res.hand.handId);
      const state = playHand(res.shoe, ["hit", "stand"]);
      expect(hand).toMatchObject({ handId: res.hand.handId, outcome: state.outcome });
      expect(legalActions(state)).toEqual([]);
      await expectLedgerMatches(userId);
    });
  });

  describe("current and history", () => {
    it("restores the hand in progress", async () => {
      const userId = await createPlayer();
      expect(await getCurrentBlackjackHand(db, userId)).toBeNull();
      const res = await startWithShoe(userId, opensWith([]));
      expect(await getCurrentBlackjackHand(db, userId)).toEqual(res.hand);
    });

    it("lists settled hands newest first, up to the limit", async () => {
      const userId = await createPlayer();
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        const res = await start(userId);
        if (res.hand.status === "player_turn") await playOut(userId, res.hand.handId);
        ids.push(res.hand.handId);
      }
      const hands = await listBlackjackHistory(db, userId, 2);
      expect(hands.map((h) => h.handId)).toEqual(ids.slice(1).reverse());
      expect(hands.every((h) => h.status === "settled")).toBe(true);
    });
  });

  it("refuses to rotate the seed pair while a hand is in progress", async () => {
    const userId = await createPlayer();
    await startWithShoe(userId, opensWith([]));
    await expect(seedPairs.rotate(db, userId)).rejects.toMatchObject({ code: "conflict" });
  });
});
