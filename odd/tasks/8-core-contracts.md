# 8-core-contracts

Issue: https://github.com/sebaveaa/casino-simulator/issues/8
Branch: stacked slices `feat/8-core-0N-*` (see Delivery)
Status: in progress

## Objective

Define the contracts every module codes against (shared types and schemas, database schema, backend service interfaces, base UI), so the auth (#9), wallet (#10), RNG (#11), roulette (#12) and infra (#13) tickets can start in parallel on stable interfaces. Interfaces and stubs only; the implementations belong to those tickets.

## Why

The team works pull-based: each member takes a free ticket. Without fixed contracts, parallel tickets clash on migrations, foreign keys, API shapes and service signatures.

## Scope

- `shared/`: money type and helpers, RNG contract, `Game<Bet, Result>`, roulette bet types, Zod schemas and paths for the first-cut API, error body.
- `backend/db/`: Kysely database types, the initial migration (tables of README §3.4, ledger guards, system accounts), a migrate script.
- `backend/`: error handling, request helpers, `WalletService`, `PaymentProvider`, `SeedPairService`, `TokenService` and the auth guard, each with a stub; DI wiring in `buildApp`.
- `frontend/`: app shell, lobby, routing, placeholder pages, `ApiClient` with a mock and an HTTP implementation.

Out of scope: real auth, ledger, RNG and game logic; routes for those modules; seed-pair API schemas (#11 adds them); a Postgres service in CI (#10 needs it for its concurrency tests).

## Design decisions

- **Money:** `bigint` minor units in code; 1 credit = 100 minor units for display. Over the API amounts are decimal strings without sign or leading zeros (`amountSchema`), signed only in history (`signedAmountSchema`), capped at the PostgreSQL `bigint` maximum.
- **Ledger sign:** `ledger_entries.amount > 0` increases the wallet balance. A deposit of 1000: issuance `-1000`, player `+1000`. Issuance is the only wallet that goes negative by design; player wallets have a `balance >= 0` check; the house may go negative.
- **Ledger guards in the database:** a deferred constraint trigger rejects a transaction whose entries do not sum to zero at commit; triggers reject `UPDATE` and `DELETE` on `ledger_entries` and `transactions`.
- **Bets and transactions:** `transactions.bet_id` (nullable FK). A bet generates zero or more transactions (stake, then payout; a race pays at settlement). This changes the README §3.4 cardinality from `o|` to `o{`; the README is updated.
- **Extra columns beyond §3.4:** `created_at` everywhere, `bets.game`, `bets.result` (needed to return the original result on an idempotent retry and for the verifier), `bets.settled_at`.
- **Idempotency keys:** `transactions.idempotency_key` is globally unique; callers store a scoped key (user and purpose), so two players cannot collide.
- **BigInt at one point:** the pg pool parses `int8` (OID 20) to `BigInt`; Kysely types declare `bigint`.
- **RNG contract:** `resolve(bet, rng)` takes an `Rng` (`int(max)`) built from the HMAC outcome, so game rules stay pure, synchronous and testable with a fake `Rng`. `computeOutcome`, `createRng` and `hashServerSeed` are stubs for #11.
- **Services take an executor:** each method receives the Kysely executor (`db` or a transaction), so a bet runs in the caller's single `BEGIN … COMMIT`.
- **Stubs throw `not_implemented` (HTTP 501).** The frontend develops against the mock API client.
- **Migrations:** Kysely `Migrator` with a static provider (bundles with esbuild); `npm run migrate` runs them; `backend/dist/migrate.js` runs them from the image.

## Tasks

- [x] T1 Plan: this document.
  Route: inline. One mechanical doc.
- [x] T2 Shared money, RNG contract, `Game` interface and roulette bet types, with tests.
  Route: delegated. Writer trigger: 2+ non-trivial files (T2 and T3 share one writer).
- [ ] T3 Shared API contract: error body, paths, `Idempotency-Key`, auth, balance, deposit, transaction history and roulette bet schemas, with tests.
  Route: delegated, same writer as T2.
- [ ] T4 Database: Kysely types, initial migration, migrate script, `int8` parser, README §3.4 and AGENTS commands.
  Route: delegated. Writer trigger: 2+ non-trivial files.
- [ ] T5 Backend: errors and request helpers, service interfaces with stubs, auth guard, `buildApp` DI wiring, tests.
  Route: delegated. Writer trigger: 2+ non-trivial files.
- [ ] T6 Frontend: router, shell, lobby, placeholder pages, `ApiClient` (mock and HTTP), styles, tests.
  Route: delegated. Writer trigger: 2+ non-trivial files.

## Acceptance criteria

From the issue:

- `shared/` exports the `Game<Bet, Result>` interface: `validateBet`, `resolve`, `payout` (README §4.1).
- `shared/` exports the RNG function signature for `HMAC-SHA256(server_seed, client_seed:nonce)` (§5.1) and the money type: integer minor units, strings over the API (§3.4).
- `shared/` exports the Zod schemas for the first-cut API: auth, balance, deposit, transaction history and roulette bet.
- Migrations create the tables of §3.4 and seed the issuance and house system accounts (§3.1); one npm script runs them.
- The backend declares `WalletService`, `PaymentProvider`, `SeedPairService` and the auth middleware, each with a stub implementation.
- The frontend has the app shell, lobby and routing, with an API client that returns mock data.
- `npm run lint`, `npm run typecheck` and `npm test` pass.

## Checks

- `npm run lint`, `npm run typecheck`, `npm test` on every task.
- T4: `docker compose up -d`, `npm run migrate` on an empty database and again (no-op); `psql` checks that an unbalanced transaction and an `UPDATE` on `ledger_entries` are rejected; `npm run build -w backend` emits `dist/migrate.js`.
- T5: `npm run build -w backend`; `GET /health` still 200 on the real stack.
- T6: `npm run build -w frontend`; dev server renders the lobby.

## TDD

Mode: off. Source: explicit user choice for this project, 2026-10-11. Runner: Vitest. Ordinary functional checks run per task.

## Review

Per the user, native review runs only for large feature merges. Task commits are recorded as "review skipped: user left candidate unreviewed"; each slice PR near the 400-line budget gets the review preflight and its consent prompt.

## Delivery

Forecast: about 1700 authored changed lines (lockfile excluded), over the 400-line budget.
Strategy: `ask-on-risk`. Chain strategy: `stacked-to-main`, from the issue note the user approved (earlier PRs `Refs #8`, the last `Closes #8`). Each slice merges into `main` on its own, so teammates get the shared contracts first.

| Slice | Branch | Base | Tasks | Forecast |
|---|---|---|---|---|
| 1 | `feat/8-core-01-shared` | `main` | T1–T3 | ~450 |
| 2 | `feat/8-core-02-database` | slice 1 | T4 | ~400 |
| 3 | `feat/8-core-03-backend` | slice 2 | T5 | ~450 |
| 4 | `feat/8-core-04-frontend` | slice 3 | T6 | ~500 |

## Progress

- Branch `feat/8-core-01-shared` created from `main` at d1962e6 (PR #7 merged).
- T2 done: `Money`, `amountSchema`/`positiveAmountSchema`/`signedAmountSchema`, `toAmount`/`parseAmount`/`formatCredits`, `NotImplementedError`, RNG contract (`Rng`, `SeedInput`, #11 stubs), `Game<Bet, Result>` and `GameId`, roulette selection/result schemas, with tests. Checks: lint clean, typecheck clean, npm test 41 passed (shared 21, backend 19, frontend 1). Review: skipped, user left candidate unreviewed.

## Next step

T1 commit, then T2.
