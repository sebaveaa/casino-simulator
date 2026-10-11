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
- **Router:** react-router 7 (8.x requires Node >= 22.22; local Node is 22.20).
- **Migrations:** Kysely `Migrator` with a static provider (bundles with esbuild); `npm run migrate` runs them; `backend/dist/migrate.js` runs them from the image.

## Tasks

- [x] T1 Plan: this document.
  Route: inline. One mechanical doc.
- [x] T2 Shared money, RNG contract, `Game` interface and roulette bet types, with tests.
  Route: delegated. Writer trigger: 2+ non-trivial files (T2 and T3 share one writer).
- [x] T3 Shared API contract: error body, paths, `Idempotency-Key`, auth, balance, deposit, transaction history and roulette bet schemas, with tests.
  Route: delegated, same writer as T2.
- [x] T4 Database: Kysely types, initial migration, migrate script, `int8` parser, README §3.4 and AGENTS commands.
  Route: delegated. Writer trigger: 2+ non-trivial files.
- [x] T5 Backend: errors and request helpers, service interfaces with stubs, auth guard, `buildApp` DI wiring, tests.
  Route: delegated. Writer trigger: 2+ non-trivial files.
- [x] T6 Frontend: router, shell, lobby, placeholder pages, `ApiClient` (mock and HTTP), styles, tests.
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

- Branch `feat/8-core-01-shared` created from `main` at d1962e6 (PR #7 merged). T1 commit 0b0f80c.
- T2 done (commit fea83f9): `Money`, `amountSchema`/`positiveAmountSchema`/`signedAmountSchema`, `toAmount`/`parseAmount`/`formatCredits`, `NotImplementedError`, RNG contract (`Rng`, `SeedInput`, #11 stubs), `Game<Bet, Result>` and `GameId`, roulette selection/result schemas, with tests. Checks: lint clean, typecheck clean, npm test 41 passed (shared 21, backend 19, frontend 1). Review: skipped, user left candidate unreviewed.
- T3 done (commit 8f31f11): `shared/src/api/` with error body and codes, `apiPaths`, `Idempotency-Key` header and schema, auth, wallet (balance, deposit, transaction history) and roulette bet schemas, with tests. Checks: lint clean, typecheck clean, npm test 64 passed (shared 44, backend 19, frontend 1). Review: skipped, user left candidate unreviewed.
- Slice 1 complete: 710 authored lines (forecast 450; schema tests account for most of the gap). Parent spot check: `npm test` 64 passed. Not pushed yet.
- T4 done (commit de39e73): Kysely 0.29.6 `Database` types, `Db`/`createDatabase`, `int8` to `BigInt` parser on the pg pool (`postgresTypes`), migration `0001_initial` (7 tables, constraints, append-only and deferred zero-sum and min-entries guards, issuance and house wallets), static migrator, `backend/migrate.ts` CLI (`npm run migrate`), build emits `dist/migrate.js`, README §3.4 and AGENTS commands. Checks: lint clean, typecheck clean, npm test 72 passed (shared 44, backend 27, frontend 1); build emits main.js and migrate.js; real DB (postgres on 5433, env passed inline because `.env` access was denied in this session): `npm run migrate` applied 0001_initial, second run "No pending migrations", `node backend/dist/migrate.js` also no-op; 7 tables; 2 system wallets (house, issuance); unbalanced tx (-100/+50) fails at `SET CONSTRAINTS ALL IMMEDIATE` and at COMMIT; balanced tx passes; tx with no entries fails at COMMIT; UPDATE and DELETE on ledger_entries and UPDATE on transactions fail ("is append-only"); negative player balance fails; bet with neither round_id nor seed_pair_id fails; `down` removed tables and functions, re-`up` restored the 2 wallets. Review: skipped, user left candidate unreviewed.
- T5 done (commit d0a2065): `AppError` and error handlers (every body matches `errorResponseSchema`), `parseWith` and `readIdempotencyKey`, `WalletService`/`PaymentProvider`/`SeedPairService`/`TokenService` interfaces with stubs that throw `NotImplementedError` (#9, #10, #11), `scopedKey`, `createAuthGuard` with `getAuth`, `Services`/`stubServices`, `moduleRoutes` extension point, `buildApp` DI wiring, `main.ts` ends the pool once through `db.destroy()` (`pool.end()` twice throws). Checks: lint clean, typecheck clean, npm test 110 passed (shared 44, backend 65, frontend 1); build ok; real stack (postgres 5433, redis, env inline): `GET /health` 200, `GET /does-not-exist` 404 with error body, shutdown path exits 0 without the pool error (SIGTERM emulated with `process.emit` because Windows cannot deliver it). Review: skipped, user left candidate unreviewed.
- T6 done (commit 30f6704): react-router 7.18.4 data router (`routes`, `Shell` with nav and balance chip, `LobbyPage` catalog, placeholder wallet/login/register/roulette pages, not found), `ApiClient` interface with `ApiError`, in-memory mock (idempotent deposit and bet, newest-first history), HTTP client validating responses with the shared schemas, `ApiProvider`/`useApi`, `createApiClient` picks HTTP when `VITE_API_URL` is set, casino theme CSS, AGENTS command note. Checks: lint clean, typecheck clean, npm test 124 passed (shared 44, backend 65, frontend 15); build 406.74 kB js (125.62 kB gzip); dev server: index has #root, /src/main.tsx and /src/app/Shell.tsx 200. Review: skipped, user left candidate unreviewed.
- Follow-up: `zod` declared in frontend `dependencies` (`http.ts` imports its types; it resolved only through hoisting). Parent spot check: `npm test` 124 passed.

## Next step

Delivery: push the four slices and open stacked PRs (user decision).
