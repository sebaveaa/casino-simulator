import { randomBytes } from "node:crypto";
import { clientSeedSchema, hashServerSeed } from "@casino/shared";
import type { Selectable } from "kysely";
import type { Db } from "../db/database";
import type { SeedPairsTable } from "../db/schema";
import { AppError } from "../platform/errors";
import type { ActiveSeedPair, SeedPairService } from "./seed-pair-service";

type SeedPairRow = Selectable<SeedPairsTable>;

/** 256 bits from the operating system's CSPRNG, as hex (README §5.1). */
const newServerSeed = (): string => randomBytes(32).toString("hex");
/** The random default client seed: 64 bits, 16 hex characters. */
const newClientSeed = (): string => randomBytes(8).toString("hex");

function toActive(row: SeedPairRow): ActiveSeedPair {
  return {
    id: row.id,
    serverSeedHash: row.server_seed_hash,
    clientSeed: row.client_seed,
    nextNonce: row.next_nonce,
  };
}

async function insertPair(db: Db, userId: string, clientSeed: string): Promise<void> {
  const serverSeed = newServerSeed();
  await db
    .insertInto("seed_pairs")
    .values({
      user_id: userId,
      server_seed: serverSeed,
      server_seed_hash: await hashServerSeed(serverSeed),
      client_seed: clientSeed,
    })
    // `seed_pairs_active_key` allows one active pair per user. Of two concurrent first
    // requests the loser inserts nothing and reads the winner's pair.
    .onConflict((oc) => oc.column("user_id").where("revealed_at", "is", null).doNothing())
    .execute();
}

const selectActive = (db: Db, userId: string) =>
  db
    .selectFrom("seed_pairs")
    .selectAll()
    .where("user_id", "=", userId)
    .where("revealed_at", "is", null);

/**
 * The user's active pair, locked until the surrounding transaction ends. Creates the first pair
 * when there is none. A concurrent rotation can reveal the pair between the lock attempts, so
 * the lookup is retried against the new one.
 */
async function lockActive(db: Db, userId: string, clientSeed?: string): Promise<SeedPairRow> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await selectActive(db, userId).forUpdate().executeTakeFirst();
    if (row) return row;
    await insertPair(db, userId, clientSeed ?? newClientSeed());
  }
  throw new Error("could not lock the active seed pair");
}

function validateClientSeed(value: string): string {
  const result = clientSeedSchema.safeParse(value);
  if (!result.success) {
    throw new AppError("invalid_request", "Client seed must be between 1 and 64 characters");
  }
  return result.data;
}

/**
 * PostgreSQL implementation of the seed pairs (README §5.1). Methods that change a pair lock its
 * row with `FOR UPDATE`; pass a transaction when several statements must commit together.
 */
export const postgresSeedPairService: SeedPairService = {
  async getActive(db, userId) {
    const existing = await selectActive(db, userId).executeTakeFirst();
    if (existing) return toActive(existing);
    await insertPair(db, userId, newClientSeed());
    return toActive(await selectActive(db, userId).executeTakeFirstOrThrow());
  },

  async draw(trx, userId) {
    const pair = await lockActive(trx, userId);
    await trx
      .updateTable("seed_pairs")
      .set({ next_nonce: pair.next_nonce + 1 })
      .where("id", "=", pair.id)
      .execute();
    return {
      seedPairId: pair.id,
      nonce: pair.next_nonce,
      seed: { serverSeed: pair.server_seed, clientSeed: pair.client_seed, nonce: pair.next_nonce },
      serverSeedHash: pair.server_seed_hash,
    };
  },

  async rotate(db, userId, clientSeed) {
    const chosen = clientSeed === undefined ? undefined : validateClientSeed(clientSeed);
    const pair = await lockActive(db, userId);
    const revealed = await db
      .updateTable("seed_pairs")
      .set({ revealed_at: new Date() })
      .where("id", "=", pair.id)
      .returning(["id", "server_seed", "server_seed_hash", "client_seed", "revealed_at"])
      .executeTakeFirstOrThrow();
    // The new pair carries the chosen client seed, or the current one when none is given.
    await insertPair(db, userId, chosen ?? pair.client_seed);
    const active = await selectActive(db, userId).executeTakeFirstOrThrow();
    if (revealed.revealed_at === null) throw new Error("rotated pair has no revealed_at");
    return {
      revealed: {
        id: revealed.id,
        serverSeed: revealed.server_seed,
        serverSeedHash: revealed.server_seed_hash,
        clientSeed: revealed.client_seed,
        revealedAt: revealed.revealed_at,
      },
      active: toActive(active),
    };
  },
};
