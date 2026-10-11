import type { SeedInput } from "@casino/shared";
import type { Db } from "../db/database";

/** The user's current provably fair seed pair; the server seed stays secret (README §5.1). */
export type ActiveSeedPair = {
  id: string;
  serverSeedHash: string;
  clientSeed: string;
  nextNonce: number;
};

/** A rotated pair, whose server seed is now public so the player can verify past bets. */
export type RevealedSeedPair = {
  id: string;
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  revealedAt: Date;
};

/** What a bet needs to compute its outcome. */
export type SeedDraw = {
  seedPairId: string;
  nonce: number;
  seed: SeedInput;
  serverSeedHash: string;
};

/** Manages each user's seed pairs and nonces (README §5.1). Implemented by #11. */
export interface SeedPairService {
  /** The active pair; creates the user's first pair if there is none. */
  getActive(db: Db, userId: string): Promise<ActiveSeedPair>;

  /**
   * Locks the active pair, takes its `next_nonce` and increments it, all inside the bet
   * transaction so a rolled-back bet does not burn a nonce.
   */
  draw(trx: Db, userId: string): Promise<SeedDraw>;

  /** Replaces the client seed of the active pair. */
  setClientSeed(db: Db, userId: string, clientSeed: string): Promise<ActiveSeedPair>;

  /** Reveals the active server seed and starts a new pair. */
  rotate(db: Db, userId: string): Promise<{ revealed: RevealedSeedPair; active: ActiveSeedPair }>;
}
