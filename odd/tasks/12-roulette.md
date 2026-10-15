# 12-roulette

Issue: https://github.com/sebaveaa/casino-simulator/issues/12
Branch: feat/12-roulette-bets (from `main` at 45cd645)
Status: in progress

## Objective

The first game end to end (README §4.2, §14): roulette rules in `shared/`, the `POST /games/roulette/bets` endpoint, and a PixiJS wheel. Also, per the user's request on this PR, `docker compose up` starts the whole stack so the team can tell when everything is running.

## Why

Roulette is the core deliverable of the first cut, and its bet flow is the template slots (#14) reuses. Today `shared/src/games/roulette.ts` has only schemas, the backend has no game route, and the page is a placeholder. Compose starts only PostgreSQL and Redis unless `--profile app` is passed, runs no migrations, and builds the portal against the mock API.

## Scope

In scope: `roulette: Game` (straight, color, parity, dozen; `resolve` to 0–36; `payout`); the bet service and route with `Idempotency-Key`, one PostgreSQL transaction and replay; the mock API using the shared rules; the PixiJS wheel and bet form on `RoulettePage`; compose running migrations, API and portal against the real API by default; docs.

Out of scope: the browser verifier screen (#15), slots (#14), other bet types (columns, splits, high/low), worker processes.

## Design decisions

- Payout is the total returned, stake included: straight 36×, color and parity 2×, dozen 3×; zero loses every outside bet (single-zero European wheel).
- `resolve` draws `rng.int(37)`; the server computes the outcome with `createRng(await computeOutcome(draw.seed))`.
- Bet flow in one `db.transaction()`: `lockBalance` → replay check by `scopedKey("roulette-bet", userId, key)` → `seedPairs.draw` → insert bet (settled) → `transfer` wallet→house (stake) → `transfer` house→wallet (payout, skipped when 0) → `getBalance`. Lock order wallets → users → seed_pairs, as `draw` documents.
- Replay rebuilds the response from the stored bet and its seed pair; the balance is the current balance. A retry charges once because `transactions.idempotency_key` is unique and the check runs after the wallet lock.
- No new migration: `bets` already has every column the flow needs.
- Compose: profiles removed; a one-shot `migrate` service (same image, `node backend/dist/migrate.js`) runs before `app`; `web` is built with `VITE_API_URL=http://localhost:3000`. Developers can still run `docker compose up -d postgres redis` and the Vite dev server outside compose.

## Tasks

- [x] T1 Shared: `roulette: Game` implementation, export, tests with fixed seeds (payout table, zero, validation, deterministic resolve from known seeds). Route: inline (one mechanical file plus its test).
- [x] T2 Backend: roulette bet service and route, registration in `moduleRoutes` and `main.ts`, route unit tests and a PostgreSQL integration test (win, loss, insufficient funds, retried bet charges once). Route: delegated (writer trigger: 3+ non-trivial files).
- [x] T3 Frontend: mock uses the shared rules; `pixi.js` dependency; wheel component animating to the server number; bet form (stake, selection) on `RoulettePage`; balance refresh; tests. Route: delegated (writer trigger).
- [ ] T4 Compose: whole stack on `docker compose up`, migrate service, web against the real API; AGENTS.md, README and `.env.example` updated. Route: delegated (writer trigger, docs + config).

## Acceptance criteria

Issue #12 criteria, all five, plus: `docker compose up --build` starts PostgreSQL, Redis, migrations, API and portal, and a player can register, deposit and bet at http://localhost:8080.

## Checks

`npm run lint`, `npm run typecheck`, `npm test` (with `TEST_DATABASE_URL` against the compose Postgres after `npm run migrate`), `npm run build -w backend`, `npm run build -w frontend`, `docker compose up --build` smoke test.

## TDD

Mode: off. Source: carried from the user's choice on #25, #11, #10 and #9 (no project-level setting). Runner: Vitest.

## Review

Native review only for large feature merges (user preference); small work units are left unreviewed.

## Delivery

Forecast: ~1100 authored lines (T1 ~150, T2 ~450, T3 ~400, T4 ~100).
Strategy: ask-on-risk. Chain strategy: feature-branch-chain (same as #11, #10, #9). The user asked for the compose change to ship in this PR; the final PR into `main` carries all four tasks and closes #12.

## Progress

- Planned. Branch `feat/12-roulette-bets` created from `main` (45cd645).
- T1 done: `roulette: Game` in shared (3fddc37).
- T2 done (this commit, ~480 authored lines): `backend/games/roulette/` (`place-bet.ts`, `routes.ts`, route unit tests, PostgreSQL integration test), registered in `moduleRoutes`; no new service or migration, `main.ts` already wires wallet and seed pairs. Replay answers 201 like deposits. Checks: lint, typecheck, build -w backend pass; `npm test` 146 passed (108 passed + 38 skipped without a database in the backend); with `TEST_DATABASE_URL` (compose Postgres on host port 5433) all 146 backend tests passed, integration tests included. Route: delegated writer.
- T3 done (this commit, ~700 authored lines including tests and CSS): `pixi.js` ^8.22.0, `pages/roulette/` (`wheelAngles` pure helpers, `wheelScene` PixiJS scene loaded with dynamic `import()`, `RouletteWheel` component), `RoulettePage` bet form, mock API on the shared rules. Checks: format, lint, typecheck pass; `npm test` 96 frontend tests passed; `npm run build -w frontend` passes (PixiJS in lazy chunks, `lib` chunk 638 kB / 180 kB gzip). Route: delegated writer.

## Next step

T4.
