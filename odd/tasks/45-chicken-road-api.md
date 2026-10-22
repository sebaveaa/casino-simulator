# 45-chicken-road-api

Issue: https://github.com/sebaveaa/casino-simulator/issues/45
Branches: PR A `feat/45-chicken-road-api`, from `feat/44-chicken-road-rules` at 659c032 (committed as df6f659); PR B `feat/45-chicken-road-routes`, from PR A.
Status: implemented; PR B commit and both PRs pending (Juan)

## Objective

Backend for Chicken Road ("Cruza la Calle"): start a game, step lane by lane, cash out, restore the current game, and list the history. Money moves only through `WalletService`. The contract in `shared/` (#44) does not change.

## Scope

In scope: migration `0004_mini_games`, `BetGame`, `backend/games/chicken-road/`, abandonment, the seed-rotation guard, the routes, tests, README §4.

Out of scope: the game screen (PR 4), a worker sweep for games whose player never returns.

Design source: `PLAN-CHICKEN-ROAD.md` phase 4, `PLAN-MINI-GAMES.md` §4, `odd/tasks/44-chicken-road-rules.md`.

## Design decisions

- **Two stacked PRs.** PR A (this branch): migration, schema, game service, abandonment, integration tests. PR B (a branch from A): routes, route tests, `moduleRoutes`, seed-rotation guard, README.
- **Migration number 0004.** `origin/feat/carrera-animales` already uses `0003_race_rounds`. See "Migration order" below.
- **The road is not stored while the game runs** (README §4.4). Each step recomputes it from `bets.seed_pair_id`, `bets.nonce`, and that pair's `server_seed` and `client_seed`. The only updates to `seed_pairs` are `next_nonce` and `revealed_at`, so these values do not change during a game. `result = { hitLane }` is written when the game settles.
- **Bet row.** `selection = {}`. `actions = [{ lane, at }]`, one per lane attempted, where `at` is PostgreSQL `now()`. State is derived from the row:
  - `payout = 0` → `lost`
  - 6 lanes crossed → `completed`
  - 0 lanes and `payout = stake` → refunded
  - otherwise → `cashed_out`
- **Lock order wallets → bets.** Every operation locks the wallet first (`lockBalance`), then the bet `FOR UPDATE`, so one player's operations run one at a time. This extends the existing wallets → users → seed_pairs order.
- **Idempotent start.** The key is `scopedKey("chicken-road-bet", userId, key)`.
  - A replay returns the **current** state of that game, so a late retry never sends the UI back to the start line.
  - A replay of a finished game answers 409: the start response only allows `in_progress`.
  - The same key with a different stake answers 409.
- **Step replay.** A `lane` already played (the lanes crossed, plus the hit lane) returns the game unchanged. A new lane on a settled game answers 409, and so does a skipped lane.
- **Single payout.** Cash out, automatic cash out at lane 6, and abandonment all pay with `scopedKey("payout", userId, betId)`, so a game is paid at most once.
- **Abandonment.** `CHICKEN_ROAD_ABANDON_MS` (10 min) after the last activity, measured with PostgreSQL `now()`. The next Chicken Road request from that player settles the game in its own transaction, before the operation runs.
  - With lanes crossed, the game is cashed out.
  - With no lanes crossed, the stake is refunded.
  - The contract has no "refunded" state, so refunded games are left out of `current` and the history, and step or cash-out on them answers 409.
- **One game in progress per player.** It is checked explicitly (409), and the partial unique index `bets_one_chicken_road_in_progress_key` backs the check up.

## Migration order

Kysely refuses to run `0003_race_rounds` once `0004_mini_games` has run on the same database. If races merges after you ran 0004 locally, roll 0004 back, then run `npm run migrate` (it applies 0003, then 0004). PowerShell:

No Chicken Road games played yet:

```powershell
docker compose exec postgres psql -U casino -d casino -c "BEGIN; DROP INDEX IF EXISTS bets_one_chicken_road_in_progress_key; ALTER TABLE bets DROP CONSTRAINT bets_game_check; ALTER TABLE bets ADD CONSTRAINT bets_game_check CHECK (game IN ('roulette','slots','races','blackjack')); DELETE FROM kysely_migration WHERE name = '0004_mini_games'; COMMIT;"
$env:DATABASE_URL="postgres://casino:casino@127.0.0.1:5433/casino"; npm run migrate
```

Chicken Road games exist. The old check rejects their rows, and the append-only ledger keeps them from being deleted, so reset the local database. This wipes all local data:

```powershell
docker compose rm -sf postgres
docker volume rm casino-simulator_postgres-data
docker compose up -d postgres
$env:DATABASE_URL="postgres://casino:casino@127.0.0.1:5433/casino"; npm run migrate
```

## Tasks

PR A:

- [x] T1 Migration `0004_mini_games` (recreate `bets_game_check`, partial unique index), registered; `BetGame` in `schema.ts`. Checked up, down, up on a scratch database.
- [x] T2 Game service: start, step, cash out, current, with the row mapper and the road recomputed from the seed. Integration tests: idempotent start (current state on replay), second start, insufficient balance, step replay and checks, step after a loss, lane 6 auto cash out, double cash out (sequential and concurrent), concurrent steps, ledger balance.
- [x] T3 Abandonment and history: `settleExpiredGame` and `listChickenRoadHistory`. Integration tests: expired with lanes → cashed out; with 0 lanes → refunded and left out of history; under the limit → untouched; history order and limit.
- [x] T4 PR A close-out: lint, typecheck, tests with the database.

PR B:

- [x] T5 `routes.ts` for the five endpoints (abandonment settled first), registered in `moduleRoutes`; `routes.test.ts` with `app.inject`.
- [x] T6 Seed rotation and client-seed change blocked during a game (`rotate` answers 409); service and route tests.
- [x] T7 README §4: Chicken Road flow and abandonment.
- [x] T8 PR B close-out: lint, typecheck, tests with the database.

## Acceptance criteria

From the issue:

- A bet is one transaction with an `Idempotency-Key`.
- A double cash out pays once.
- At most one game in progress per player.
- An abandoned game does not lose the money.
- Route and integration tests exist.
- The migration is new; no existing one is edited.

## Checks

PowerShell:

```powershell
npm run lint
npm run typecheck
$env:TEST_DATABASE_URL="postgres://casino:casino@127.0.0.1:5433/casino"; npm test
```

## Delivery

Forecast: about 1000 authored changed lines, split into two stacked PRs (A ≈ 650, B ≈ 350). Actual PR A: about 1075 lines (production code about 510, integration tests about 460, task file about 105). If that is too large to review, move abandonment and history (T3: `expiry.ts`, the history query, and their tests, about 200 lines) into a PR of their own between A and B. Juan makes the commits, pushes, branches, and opens the PRs (`Closes #45` on PR B, "Part of #45" on PR A). The agent only edits files and runs checks.

## Progress

- Planned. Branch `feat/45-chicken-road-api` created by Juan from `feat/44-chicken-road-rules`.
- T1 done: `0004_mini_games` (checked `origin/feat/carrera-animales`, which uses 0003) recreates `bets_game_check` with `chicken-road`, `dino-crash`, `aviator` and adds `bets_one_chicken_road_in_progress_key`. It is registered in `migrations/index.ts`, and `BetGame` is updated. Migrated up, down, up on a scratch database (`casino_scratch`, dropped afterwards), then applied to the local database on port 5433.
- T2 done: `view.ts` (bet + seed pair select, locks on the bet row only via `forUpdate("b")`, row → contract mapping, road recomputed from the seed, `databaseNow`) and `game.ts` (`startChickenRoadGame`, `stepChickenRoadGame`, `cashOutChickenRoadGame`, `settleGame`). The `scopedKey` doc lists the new purposes. Integration tests cover start, replay with the current state, one game in progress, insufficient balance, step replay and skipped lane, loss, goal, concurrent steps, another player's game, cash out once (sequential and concurrent), and cash out at lane 0.
- T3 done: `expiry.ts` (`CHICKEN_ROAD_ABANDON_MS`, `settleExpiredGame`), `getCurrentChickenRoadGame`, `listChickenRoadHistory`. Integration tests cover an abandoned game with lanes (with the just-under-the-limit case), an abandoned game refunded at 0 lanes, and history order and limit.
- T4 done. `npm run lint` clean (172 files). `npm run typecheck` clean in every workspace. With `TEST_DATABASE_URL` on port 5433, the backend has 167 tests passed and 0 skipped: all 58 integration tests ran, 15 of them new. Shared has 158 passed. The frontend has 155 of 156 passed: `RoulettePage.test.tsx` "stacks the selected chip..." times out at 5 s when every workspace runs at once and passes alone (25/25). It is not touched by this work.
- PR A committed by Juan (df6f659). Branch `feat/45-chicken-road-routes` created from it.
- T5 done: `routes.ts` covers the five endpoints on `apiPaths.chickenRoad*`. Each runs `settleExpiredGame` in its own transaction after validating the request. Start answers 201, the others 200. The routes are registered in `moduleRoutes`. `routes.test.ts` (13 tests) checks 401 on every route, Idempotency-Key, stake bounds, step and cash-out bodies, the history `limit`, the hand-off arguments, 409 and 404 pass-through, and that bodies parse with the shared schemas.
- T6 done: `postgresSeedPairService.rotate` answers 409 when a bet drawn from the active pair is in progress. The client-seed change goes through `rotate` (`rng/routes.ts`), so it is blocked too; the interface doc says so. Integration tests: both `rotate()` and `rotate(clientSeed)` are refused until the game settles, and a start racing a rotation never ends with the game's pair revealed. Route test: both endpoints answer 409.
- Fixed a flaky PR A test: "cashes out an abandoned game with lanes crossed" took the first history entry, but `age` moves the game's start back, so games played out earlier could sort as newer. It now looks the game up by id. Six runs in a row passed.
- T7 done: README §4.5 "Cruza la Calle (partida por pasos)".
- T8 done. `npm run lint` clean (174 files). `npm run typecheck` clean. With `TEST_DATABASE_URL` on port 5433, the backend has 183 passed and 0 skipped: all 60 integration tests ran, 2 of them new (seed pairs). Without the database, 60 are skipped. Shared has 158 passed. The frontend has 155 of 156: the same `RoulettePage.test.tsx` timeout under full-suite load, which passes alone (25/25).
- Note: an abandoned game blocks seed rotation until the player opens Chicken Road again, because abandoned games are settled only by Chicken Road requests.

## Next step

Juan reviews and commits PR B, and opens PR A ("Part of #45") and PR B (`Closes #45`), stacked.
