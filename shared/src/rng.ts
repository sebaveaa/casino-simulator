import { NotImplementedError } from "./not-implemented";

/** Inputs of the provably fair outcome (README §5.1). */
export type SeedInput = { serverSeed: string; clientSeed: string; nonce: number };

/** HMAC-SHA256(serverSeed, `${clientSeed}:${nonce}`) as 64 lowercase hex chars. */
export type Outcome = string;

/**
 * Deterministic integer source built from one outcome. Game rules receive an
 * `Rng`, so they stay pure and synchronous and tests can pass a fake.
 */
export interface Rng {
  /** Integer in [0, max). Successive calls consume further bits of the outcome. */
  int(max: number): number;
}

// The three functions below are implemented by issue #11 with Web Crypto
// (`crypto.subtle`), so Node and the browser verifier share one implementation.

/** Computes the HMAC-SHA256 outcome for a seed input. */
export async function computeOutcome(_seed: SeedInput): Promise<Outcome> {
  throw new NotImplementedError("computeOutcome", "#11");
}

/** Builds the deterministic `Rng` for an outcome. */
export function createRng(_outcome: Outcome): Rng {
  throw new NotImplementedError("createRng", "#11");
}

/** SHA-256 of the server seed as hex; published before bets are placed. */
export async function hashServerSeed(_serverSeed: string): Promise<string> {
  throw new NotImplementedError("hashServerSeed", "#11");
}
