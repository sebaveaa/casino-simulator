# 44-chicken-road-rules

Issue: https://github.com/sebaveaa/casino-simulator/issues/44
Branch: `feat/44-chicken-road-rules`, from `feat/43-mini-games-hub` at 68ec351.
Status: implemented, PR pending (Juan commits and opens it)

## Objective

Pure, verifiable Chicken Road ("Cruza la Calle") rules in `shared/`, and the API contract (Zod schemas and `apiPaths`) the backend and the game screen build on.

## Why

Chicken Road is the first mini game. Its rules must be pure so the browser verifier (#15) runs the exact server code (README §4.1, §5.3), and the backend and frontend PRs that follow need one shared contract.

## Scope

In scope: `shared/src/games/chicken-road.ts`, `shared/src/api/chicken-road.ts`, new `apiPaths`, exports, tests; `"chicken-road"` in `gameIds`.

Out of scope: the migration, the transactional flow and the routes (backend PR); the game screen (PR 4); abandonment timeout (backend).

Design source: `PLAN-CHICKEN-ROAD.md` phase 3, `PLAN-MINI-GAMES.md` §3.2 and §4, `DISENO-MINIJUEGOS.md` (screen states, "Formatos"), all kept outside the repo.

## Design decisions

- **`GameId` gains `"chicken-road"`** so the rules implement `Game` like `roulette`. The one line outside `shared/`: `GameArtId` in `frontend/src/pages/GameIcons.tsx` also excludes `"chicken-road"`, because the lobby art record only covers lobby entries (Juan's choice). The backend's `BetGame` is a separate type; the database check gains the id in the backend migration.
- **A stepped game fits `Game` through `cashOutAt`.** `ChickenRoadBet = Wager & { cashOutAt }`, the lanes the player tried to cross (1 to 6; 6 is the goal). Every finished game is one such bet: cashing out after N lanes is `cashOutAt = N`; being hit on lane h is any `cashOutAt >= h`. `resolve` returns the road `{ hitLane }`, which ignores the bet, so the server fixes it when the game starts and the verifier replays it.
- **`resolve` draws `rng.int(100)` per lane, 1 to 6, and stops at the first draw `>= 80`.** That lane is `hitLane`; `null` means every lane is safe.
- **Game ids keep their literal type.** `roulette` and `chickenRoad` are typed `Game<...> & { readonly id: "<literal>" }`. With `id: GameId` alone, adding `"chicken-road"` to `GameId` broke the backend typecheck: `placeRouletteBet` stores `roulette.id` in `bets.game`, typed `BetGame`, which does not list `"chicken-road"` until the backend migration. The literal is what the id really is, and `backend/` stays untouched.
- **Multipliers use integers only**: `mult_k = floor(96 * 100^k / 80^k)` in `bigint` (equal to `floor(96 * 5^k / 4^k)`) = `[120, 150, 187, 234, 292, 366]` hundredths. The float formula `100 * 0.96 / 0.8 ** k` gives 149 for k = 2; a test pins that.
- **Payout** = `floor(stake * mult / 100)` as `bigint`, stake included. Stakes go from 10 to 500 credits (1000 to 50000 minor units).
- **A game in the API is a union on `status`**: `in_progress`, `lost`, `cashed_out`, `completed`. Together with "no current game" (the bet form) they are the five states of the design. `in_progress` is a strict object and never carries `hitLane`: knowing it would tell the player where the car is.
- **Step and cash-out requests name the game** (`gameId`), and a step names the lane it tries to cross (`lane`). A retried or double-clicked step with the same `lane` can replay instead of advancing two lanes, and a second cash-out can return the settled game instead of 404. Paths stay as in the plan (`/games/chicken-road/games/current/...`).
- **History**: `GET /games/chicken-road/games?limit=` (default 5, at most 20) returns the player's latest finished games, newest first, with the same game schema minus `in_progress`.
- `fairnessSchema` is reused from `api/roulette.ts`, so the verifier reads the same fields for both games.

## Tasks

- [x] T1 Pure rules in `shared/src/games/chicken-road.ts`: config, integer multipliers, `chickenRoad: Game` (`validateBet`, `resolve`, `payout`), `chickenRoadPayout`, stake helper; `gameIds` and `GameArtId`; tests with fixed seeds and a fake `Rng`, including the float pitfall.
  Route: inline.
- [x] T2 Zod schemas in `shared/src/api/chicken-road.ts` (start, step, cash-out, current, history), `apiPaths`, exports; tests.
  Route: inline.
- [x] T3 Final checks and task file close-out.
  Route: inline.

## Acceptance criteria

From the issue:

- Integer multipliers derived from p = 0.8 and a 96 % return.
- `resolve` is pure and tested with fixed seeds.
- Zod schemas and `apiPaths` exist.
- Amounts are `bigint` and travel as strings.

## Checks

- `npm run lint`
- `npm run typecheck`
- `npm test`

## TDD

Mode: off. Source: carried from the user's choice on earlier tickets (no project-level setting). Runner: Vitest.

## Delivery

Forecast: about 400 authored changed lines. Strategy: `single-pr`, stacked on #43. Juan makes the commits, pushes and opens the PR (`Closes #44`); the agent only edits files and runs checks.

## Progress

- Planned. Branch `feat/44-chicken-road-rules` created by Juan from `feat/43-mini-games-hub`.
- T1 done: `chicken-road.ts` (config, `CHICKEN_ROAD_MULTIPLIERS`, `chickenRoadMultiplier`, `chickenRoadPayout`, `isValidChickenRoadStake`, `chickenRoad`), exported from `index.ts`; `"chicken-road"` in `gameIds`; `GameArtId` excludes it; roulette's id narrowed to its literal (see design decisions). Tests: multiplier table and the float pitfall, payout floor and bounds, stake and cash-out validation, `resolve` with a fake `Rng` (lane 1, lane 4, goal; no draw after the hit) and fixed seeds (nonce 0 → lane 3, 4 → goal, 5 → lane 1), road independent of the bet. Checks: lint, typecheck, shared tests pass.
- T2 done: `api/chicken-road.ts` with the game union (`in_progress` strict, `lost`, `cashed_out`, `completed`), the finished-game union, start/step/cash-out/current/history request and response schemas, the stake bounds refined on the start request, and the history query (`limit` coerced, default 5, max 20); four `apiPaths` entries; exported from `api/index.ts`. Tests: each state, `hitLane` rejected in progress, lanes that do not fit a state, stake bounds and malformed stakes, step lane 1 to 6, cash-out returns only paid games, current is in progress or null, history limits and finished games only, the paths. Checks: lint, typecheck, shared tests pass.
- T3 done. Final checks: `npm run lint` clean (167 files); `npm run typecheck` clean in every workspace; `npm test` green: shared 158, backend 109 passed and 43 skipped (no database), frontend 156.

## Next step

Juan reviews the diff, commits and opens the PR (`Closes #44`), stacked on #43. The backend PR adds `"chicken-road"` to `BetGame` and `bets_game_check`, and implements the step replay by `lane` and the cash-out replay by `gameId`.
