# crash-api

Issue: TBD — letter **D** of `PLAN-CRASH.md` §7 (Claudia creates the GitHub issue).
Branch: `feat/crash-api`, from `feat/crash-rules`.
Status: implemented, PR pending (Claudia commits and opens it).

## Objective

The Crash REST API: place a bet, cash out, read the current round, and list the history, with money
moved only by `WalletService` and the cash-out decided by the PostgreSQL clock (PLAN-CRASH §5.2, §5.3).

## Why

The two Crash screens and the worker need the transactional engine before anything is playable. The
cash-out is the hardest rule: it must be idempotent, server-timed, and pay once (README §3.2, §3.3).

## Scope

In scope: `backend/games/crash/{selection,rounds,place-bet,cashout,routes}.ts` and tests; registration
in `moduleRoutes`; fixed round timings in `shared/src/games/crash.ts`.

Out of scope: the SSE stream route and the realtime bus (branch C); the worker that opens/settles
rounds (branch E).

## Preexisting files touched (additive only)

- `backend/platform/routes.ts` — import `crashRoutes` and append it to `moduleRoutes`.
- `shared/src/games/crash.ts` (created in branch B) — add `CRASH_BETTING_WINDOW_MS` and
  `CRASH_INTERMISSION_MS`.

## Design decisions (DECISIÓN)

- **No migration 0008.** The audit confirmed nothing is missing: `bets_game_check` already accepts the
  Crash ids (0004), there is no CHECK on `game_rounds.game`, and `bets_round_user_key` (0005) already
  enforces one bet per player per round. The "one active round per game" guarantee is the worker's
  advisory lock (branch E), not a DB index.
- **Settings are fixed constants, not env config.** Stake bounds (`CRASH_MIN_STAKE`/`CRASH_MAX_STAKE`)
  and timings (`CRASH_BETTING_WINDOW_MS` 8 s, `CRASH_INTERMISSION_MS` 3 s) live in
  `shared/src/games/crash.ts`. Reason: `backend/platform/app.ts` (which wires `Config` into the route
  deps) and `services.ts` are **not** in the allowed-to-touch set, so route config cannot be extended
  without them; and PLAN-CRASH §3.1 calls the window "constante". The worker (branch E) reads the same
  constants. Result: no `config.ts`/`.env.example` change is needed.
- **Routes under `/games/crash/:game/...`**, `:game` validated against `crashGameSchema` before any
  work, so an unknown game is a 400.
- **Place-bet mirrors `placeRaceBet`**: round `FOR SHARE` then player wallet, idempotency replay keyed
  `scopedKey("crash-bet", ...)`, one bet per round via the existing partial unique index. Bets carry
  an empty `selection` (`{}`); the stake is the whole bet.
- **Cash-out (`cashout.ts`) is the critical path.** Locks the bet `FOR UPDATE` first (the worker
  settles with `SKIP LOCKED`, so no deadlock), reads the round unlocked, derives the impact point from
  the seed, and measures `elapsedMs = clock_timestamp() - closes_at` on the server. It accepts only
  while `elapsedMs < impactAtMs(crash)`; pays `house -> player` with `scopedKey("crash-payout", ...)`
  so a double click pays once; stores the cash-out in `actions` and `result`. A settled bet replays
  (if it cashed out) or is refused (if it lost).
- **`bets.result`/`actions` shapes** live in `selection.ts` (`crashBetResultSchema`,
  `crashActionsSchema`), shared with the worker.

## Tasks

- [x] T1 Round queries and mappers (`rounds.ts`, `selection.ts`).
- [x] T2 `placeCrashBet` (`place-bet.ts`) + integration tests.
- [x] T3 `cashOutCrashBet` (`cashout.ts`) + integration tests.
- [x] T4 Routes (`routes.ts`) + route tests; register in `moduleRoutes`; shared timings; checks.

## Acceptance criteria (letter D)

- Idempotent bet; one bet per player per round; a double cash-out pays once; the cash-out is decided
  with the PostgreSQL time; the migration is new only if needed (it is not); route and integration tests.

## Checks

- `npm run lint` — clean.
- `npm run typecheck` — clean.
- `TEST_DATABASE_URL=... TEST_REDIS_URL=... npm test` — green: shared 219, backend 323, frontend 331.
  No new failures vs the known baseline (0).

## Progress

- Branch `feat/crash-api` from `feat/crash-rules`.
- All four tasks done; crash backend tests: 28 passing (routes 15, place-bet 10, cashout 6 — minus
  overlap), full suite green.
