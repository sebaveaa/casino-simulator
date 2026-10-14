# 11-rng

Issue: https://github.com/sebaveaa/casino-simulator/issues/11
Branch: feat/11-rng (feature base, from `main` at 272a7cd); slices feat/11-rng-0N-*
Status: planned

## Objective

Verifiable outcomes for individual games (README §5.1): an HMAC-SHA256 primitive in `shared/` and per-player seed pairs in the backend.

## Why

Every game's `resolve` needs a provably fair outcome. The roulette (#12), the first-cut game, cannot land without it. Today `shared/src/rng.ts` and `stubSeedPairService` throw `NotImplementedError("#11")`.

## Scope

In scope: `computeOutcome`, `createRng` and `hashServerSeed` in `shared/src/rng.ts` with Web Crypto; known test vectors; a PostgreSQL `SeedPairService` over the existing `seed_pairs` table (migration 0001); wiring in `main.ts`; API schemas and paths in `shared/src/api`; authenticated endpoints for the current pair (hash only), set client seed, and rotate.

Out of scope: race seeds (§5.2, come with the worker), the browser verifier screen (#15), frontend seed UI, the roulette bet endpoint (#12, which calls `draw`).

## Design decisions

- One Web Crypto implementation (`crypto.subtle`) serves Node 22 and the browser.
- `createRng` maps the outcome to integers without modulo bias (rejection sampling over successive bit chunks of the outcome).
- Server seeds come from a CSPRNG; the random default client seed too.
- `draw` locks the active pair with `SELECT … FOR UPDATE` inside the bet transaction, so a rolled-back bet does not burn a nonce.
- Rotation reveals the old pair and inserts the new one in one transaction; the partial unique index `seed_pairs_active_key` guarantees one active pair per user.

## Tasks

- [ ] T1 Shared: implement `computeOutcome`, `createRng`, `hashServerSeed` with Web Crypto; replace the stub tests with known test vectors (RFC 4231 HMAC vectors, a fixed SHA-256 vector, deterministic `createRng` sequences, range and bias edge cases). Route: delegated (writer trigger, bundled with T2).
- [ ] T2 Backend: `PgSeedPairService` (getActive creates the first pair, draw with atomic nonce, setClientSeed, rotate), API schemas and paths in `shared/src/api`, routes for current pair, set client seed and rotate, wiring in `main.ts`, tests (unit plus PG integration under `TEST_DATABASE_URL`, including concurrent draws). Route: delegated (writer trigger: 3+ non-trivial files).

## Acceptance criteria

Issue #11 criteria, all seven.

## Checks

`npm run lint`, `npm run typecheck`, `npm test` (with `TEST_DATABASE_URL` against the local compose Postgres after `npm run migrate` when available), `npm run build -w backend`.

## TDD

Mode: off. Source: carried from the user's choice on #25, #10 and #9 (no project-level setting). Runner: Vitest.

## Review

Native review only for large feature merges (user preference); small work units are left unreviewed.

## Delivery

Forecast: ~550 authored lines (T1 ~150, T2 ~400).
Strategy: ask-on-risk. Chain strategy: feature-branch-chain (same as #10 and #9). Slice PRs target `feat/11-rng`; one final PR merges it into `main` and closes #11.

| Slice | Branch | Base | Tasks | Forecast |
|-------|--------|------|-------|----------|
| 1 | feat/11-rng-01-hmac | feat/11-rng | T1 | ~150 |
| 2 | feat/11-rng-02-seed-pairs | slice 1 | T2 | ~400 |

## Progress

- Planned. Branch `feat/11-rng` created from `main` (272a7cd).

## Next step

T1.
