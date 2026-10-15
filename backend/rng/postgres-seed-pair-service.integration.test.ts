import { randomUUID } from "node:crypto";
import { computeOutcome, hashServerSeed } from "@casino/shared";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Db } from "../db/database";
import { AppError } from "../platform/errors";
import { postgresTypes } from "../platform/postgres";
import { postgresSeedPairService as seedPairs } from "./postgres-seed-pair-service";

// Runs against a migrated database: `TEST_DATABASE_URL=... npm test` (see AGENTS.md). Every
// test creates its own user instead of cleaning up.
describe.skipIf(!process.env.TEST_DATABASE_URL)("PostgresSeedPairService", () => {
  let pool: pg.Pool;
  let db: Db;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, types: postgresTypes });
    db = createDatabase(pool);
  });

  afterAll(async () => {
    await db.destroy();
  });

  async function createUser(): Promise<string> {
    const user = await db
      .insertInto("users")
      .values({ email: `${randomUUID()}@test.local`, password_hash: "not-a-real-hash" })
      .returning("id")
      .executeTakeFirstOrThrow();
    return user.id;
  }

  const draw = (userId: string) => db.transaction().execute((trx) => seedPairs.draw(trx, userId));
  const rotate = (userId: string, clientSeed?: string) =>
    db.transaction().execute((trx) => seedPairs.rotate(trx, userId, clientSeed));
  const openPairs = (userId: string) =>
    db
      .selectFrom("seed_pairs")
      .select("id")
      .where("user_id", "=", userId)
      .where("revealed_at", "is", null)
      .execute();

  it("creates the first pair on demand, with a random client seed and nonce 0", async () => {
    const userId = await createUser();
    const pair = await seedPairs.getActive(db, userId);
    expect(pair.serverSeedHash).toMatch(/^[0-9a-f]{64}$/);
    expect(pair.clientSeed.length).toBeGreaterThan(0);
    expect(pair.nextNonce).toBe(0);
    expect(await seedPairs.getActive(db, userId)).toEqual(pair);
    const other = await seedPairs.getActive(db, await createUser());
    expect(other.clientSeed).not.toBe(pair.clientSeed);
  });

  it("creates exactly one pair when the first requests race", async () => {
    const userId = await createUser();
    const pairs = await Promise.all(
      Array.from({ length: 8 }, () => seedPairs.getActive(db, userId)),
    );
    expect(new Set(pairs.map((p) => p.id)).size).toBe(1);
    const rows = await db
      .selectFrom("seed_pairs")
      .select("id")
      .where("user_id", "=", userId)
      .execute();
    expect(rows).toHaveLength(1);
  });

  it("publishes the SHA-256 hash of the stored server seed", async () => {
    const userId = await createUser();
    const pair = await seedPairs.getActive(db, userId);
    const row = await db
      .selectFrom("seed_pairs")
      .select("server_seed")
      .where("id", "=", pair.id)
      .executeTakeFirstOrThrow();
    expect(row.server_seed).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashServerSeed(row.server_seed)).toBe(pair.serverSeedHash);
  });

  it("draws increasing nonces and returns the seed to compute the outcome", async () => {
    const userId = await createUser();
    const first = await draw(userId);
    const second = await draw(userId);
    expect([first.nonce, second.nonce]).toEqual([0, 1]);
    expect(first.seedPairId).toBe(second.seedPairId);
    expect(first.seed.nonce).toBe(0);
    expect(await hashServerSeed(first.seed.serverSeed)).toBe(first.serverSeedHash);
    expect(await computeOutcome(first.seed)).not.toBe(await computeOutcome(second.seed));
    expect((await seedPairs.getActive(db, userId)).nextNonce).toBe(2);
  });

  it("does not burn a nonce when the drawing transaction rolls back", async () => {
    const userId = await createUser();
    await expect(
      db.transaction().execute(async (trx) => {
        await seedPairs.draw(trx, userId);
        throw new Error("bet failed");
      }),
    ).rejects.toThrow("bet failed");
    expect((await draw(userId)).nonce).toBe(0);
  });

  it("gives concurrent draws distinct, gapless nonces", async () => {
    const userId = await createUser();
    await seedPairs.getActive(db, userId);
    const draws = await Promise.all(Array.from({ length: 10 }, () => draw(userId)));
    const nonces = draws.map((d) => d.nonce).sort((a, b) => a - b);
    expect(nonces).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect((await seedPairs.getActive(db, userId)).nextNonce).toBe(10);
  });

  it("changing the client seed rotates: the old pair keeps its seed, the new one starts at nonce 0", async () => {
    const userId = await createUser();
    const before = await draw(userId);
    const { revealed, active } = await rotate(userId, "my-client-seed");

    expect(revealed.id).toBe(before.seedPairId);
    expect(revealed.serverSeed).toBe(before.seed.serverSeed);
    expect(await hashServerSeed(revealed.serverSeed)).toBe(before.serverSeedHash);
    expect(revealed.clientSeed).toBe(before.seed.clientSeed);
    expect(active.id).not.toBe(revealed.id);
    expect(active.serverSeedHash).not.toBe(revealed.serverSeedHash);
    expect(active.clientSeed).toBe("my-client-seed");
    expect(active.nextNonce).toBe(0);
    expect((await draw(userId)).seed.clientSeed).toBe("my-client-seed");
    expect(await openPairs(userId)).toHaveLength(1);
    const old = await db
      .selectFrom("seed_pairs")
      .select("client_seed")
      .where("id", "=", revealed.id)
      .executeTakeFirstOrThrow();
    expect(old.client_seed).toBe(before.seed.clientSeed);
  });

  it("sets the client seed of a user with no pair yet", async () => {
    const userId = await createUser();
    const { active } = await rotate(userId, "first-seed");
    expect(active.clientSeed).toBe("first-seed");
    expect(active.nextNonce).toBe(0);
    expect(await openPairs(userId)).toHaveLength(1);
  });

  it.each(["", "x".repeat(65)])(
    "rejects the client seed of length %# and leaves the pair untouched",
    async (clientSeed) => {
      const userId = await createUser();
      const before = await seedPairs.getActive(db, userId);
      const error = await rotate(userId, clientSeed).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("invalid_request");
      expect(await seedPairs.getActive(db, userId)).toEqual(before);
    },
  );

  it("rotates: reveals the old server seed and creates a fresh active pair", async () => {
    const userId = await createUser();
    await rotate(userId, "keep-me");
    const before = await draw(userId);
    const { revealed, active } = await rotate(userId);

    expect(revealed.id).toBe(before.seedPairId);
    expect(revealed.serverSeed).toBe(before.seed.serverSeed);
    expect(await hashServerSeed(revealed.serverSeed)).toBe(before.serverSeedHash);
    expect(revealed.clientSeed).toBe("keep-me");
    expect(active.id).not.toBe(revealed.id);
    expect(active.serverSeedHash).not.toBe(revealed.serverSeedHash);
    expect(active.clientSeed).toBe("keep-me");
    expect(active.nextNonce).toBe(0);
    expect((await seedPairs.getActive(db, userId)).id).toBe(active.id);
    expect(await openPairs(userId)).toHaveLength(1);
  });

  it("rotates a user with no pair yet and leaves one active pair", async () => {
    const userId = await createUser();
    const { revealed, active } = await rotate(userId);
    expect(revealed.id).not.toBe(active.id);
    expect(await openPairs(userId)).toHaveLength(1);
  });

  it("serializes concurrent rotations into one consistent chain", async () => {
    const userId = await createUser();
    const first = await draw(userId);
    const results = await Promise.all(Array.from({ length: 8 }, () => rotate(userId)));

    // Every rotation succeeds and reveals a different pair.
    const revealedIds = results.map((r) => r.revealed.id);
    expect(new Set(revealedIds).size).toBe(8);
    expect(revealedIds).toContain(first.seedPairId);

    // The chain is consistent: each rotation's new pair is revealed by exactly one later
    // rotation, except the last one, which is the single active pair.
    const open = await openPairs(userId);
    expect(open).toHaveLength(1);
    const activeIds = results.map((r) => r.active.id);
    expect(new Set(activeIds).size).toBe(8);
    expect(activeIds.filter((id) => !revealedIds.includes(id))).toEqual([open[0]?.id]);
    for (const { revealed } of results) {
      expect(await hashServerSeed(revealed.serverSeed)).toBe(revealed.serverSeedHash);
    }
    const all = await db
      .selectFrom("seed_pairs")
      .select("id")
      .where("user_id", "=", userId)
      .execute();
    expect(all).toHaveLength(9);
  });

  it("keeps draws and rotations racing without failures or lost nonces", async () => {
    const userId = await createUser();
    await seedPairs.getActive(db, userId);
    const operations = Array.from({ length: 12 }, (_, i) =>
      i % 3 === 0 ? rotate(userId) : draw(userId),
    );
    const results = await Promise.all(operations);
    expect(await openPairs(userId)).toHaveLength(1);

    // No (pair, nonce) was handed out twice.
    const drawn = results.filter((r) => "nonce" in r) as Awaited<ReturnType<typeof draw>>[];
    expect(drawn).toHaveLength(8);
    const keys = drawn.map((d) => `${d.seedPairId}:${d.nonce}`);
    expect(new Set(keys).size).toBe(8);
  });
});
