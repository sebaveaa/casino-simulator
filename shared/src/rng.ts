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

const encoder = new TextEncoder();

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Web Crypto (`crypto.subtle`) is the same API in Node 22 and in browsers, so the server and
 * the browser verifier share this implementation byte for byte.
 */
async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message));
  return toHex(new Uint8Array(signature));
}

/** Computes the HMAC-SHA256 outcome for a seed input. */
export async function computeOutcome(seed: SeedInput): Promise<Outcome> {
  if (!Number.isSafeInteger(seed.nonce) || seed.nonce < 0) {
    throw new RangeError("nonce must be a non-negative safe integer");
  }
  return hmacSha256Hex(seed.serverSeed, `${seed.clientSeed}:${seed.nonce}`);
}

/** SHA-256 of the server seed as hex; published before bets are placed. */
export async function hashServerSeed(serverSeed: string): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(serverSeed))));
}

// `Rng.int` is synchronous, but `crypto.subtle` is async. A 256-bit outcome runs out of bits
// quickly (rejection sampling spends several per draw), and the extension must be
// deterministic so the verifier replays the exact server sequence. A small pure SHA-256
// keeps `int` synchronous without pre-deriving a guessed number of blocks.
// prettier-ignore
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));

/** Pure synchronous SHA-256 (FIPS 180-4). Exported so tests can pin it to `crypto.subtle`. */
export function sha256Sync(message: Uint8Array): Uint8Array {
  const bitLength = message.length * 8;
  const padded = new Uint8Array(Math.ceil((message.length + 9) / 64) * 64);
  padded.set(message);
  padded[message.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 2 ** 32));
  view.setUint32(padded.length - 4, bitLength >>> 0);

  const state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const w15 = w[i - 15] as number;
      const w2 = w[i - 2] as number;
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      w[i] = (w[i - 16] as number) + s0 + (w[i - 7] as number) + s1;
    }

    const v = Uint32Array.from(state);
    for (let i = 0; i < 64; i++) {
      const [a, b, c, d, e, f, g, h] = v as unknown as [
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
      ];
      const t1 =
        h +
        (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) +
        ((e & f) ^ (~e & g)) +
        (K[i] as number) +
        (w[i] as number);
      const t2 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c));
      v.set([t1 + t2, a, b, c, d + t1, e, f, g]);
    }
    for (let i = 0; i < 8; i++) state[i] = (state[i] as number) + (v[i] as number);
  }

  const digest = new Uint8Array(32);
  const out = new DataView(digest.buffer);
  for (let i = 0; i < 8; i++) out.setUint32(i * 4, state[i] as number);
  return digest;
}

const OUTCOME_PATTERN = /^[0-9a-f]{64}$/;

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Builds the deterministic `Rng` for an outcome.
 *
 * `int(max)` reads `ceil(log2(max))` bits from the stream, most significant bit first, and
 * accepts the value if it is below `max`; otherwise it discards the chunk and reads the next
 * one (rejection sampling, so there is no modulo bias). The stream starts with the 256 bits
 * of the outcome. When they run out it continues with SHA-256(`${outcome}:${n}`) for
 * n = 1, 2, ..., 256 bits per block, so any number of draws is deterministic and verifiable.
 */
export function createRng(outcome: Outcome): Rng {
  if (!OUTCOME_PATTERN.test(outcome)) {
    throw new RangeError("outcome must be 64 lowercase hex characters");
  }
  let buffer = hexToBytes(outcome);
  let bitPosition = 0;
  let block = 0;

  function nextBit(): number {
    if (bitPosition === buffer.length * 8) {
      block += 1;
      buffer = sha256Sync(encoder.encode(`${outcome}:${block}`));
      bitPosition = 0;
    }
    const byte = buffer[bitPosition >> 3] as number;
    const bit = (byte >> (7 - (bitPosition & 7))) & 1;
    bitPosition += 1;
    return bit;
  }

  return {
    int(max) {
      if (!Number.isSafeInteger(max) || max < 1) {
        throw new RangeError("max must be a positive safe integer");
      }
      if (max === 1) return 0;
      const bits = Math.ceil(Math.log2(max));
      for (;;) {
        // Multiplication, not shifts: up to 53 bits do not fit in a 32-bit shift.
        let value = 0;
        for (let i = 0; i < bits; i++) value = value * 2 + nextBit();
        if (value < max) return value;
      }
    },
  };
}
