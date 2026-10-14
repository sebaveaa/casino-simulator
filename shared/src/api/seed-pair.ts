import { z } from "zod";

/** Length bounds of a client seed; `fairnessSchema` in `roulette.ts` echoes the same bounds. */
export const CLIENT_SEED_MAX_LENGTH = 64;
export const clientSeedSchema = z.string().min(1).max(CLIENT_SEED_MAX_LENGTH);

const hexHashSchema = z.string().regex(/^[0-9a-f]{64}$/, "Expected 64 lowercase hex characters");

/** The active pair as the player sees it: the server seed is never part of it (README §5.1). */
export const seedPairResponseSchema = z.object({
  id: z.uuid(),
  serverSeedHash: hexHashSchema,
  clientSeed: clientSeedSchema,
  /** Nonce the next bet will take. */
  nextNonce: z.number().int().min(0),
});
export type SeedPairResponse = z.infer<typeof seedPairResponseSchema>;

export const setClientSeedRequestSchema = z.object({ clientSeed: clientSeedSchema });
export type SetClientSeedRequest = z.infer<typeof setClientSeedRequestSchema>;

/** A rotated pair: its server seed is public now, so past bets can be recomputed. */
export const revealedSeedPairSchema = z.object({
  id: z.uuid(),
  serverSeed: z.string().min(1),
  serverSeedHash: hexHashSchema,
  clientSeed: clientSeedSchema,
  revealedAt: z.iso.datetime({ offset: true }),
});
export type RevealedSeedPairResponse = z.infer<typeof revealedSeedPairSchema>;

export const rotateSeedPairResponseSchema = z.object({
  revealed: revealedSeedPairSchema,
  active: seedPairResponseSchema,
});
export type RotateSeedPairResponse = z.infer<typeof rotateSeedPairResponseSchema>;
