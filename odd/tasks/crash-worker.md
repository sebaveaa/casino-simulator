# crash-worker

Issue: TBD — letter **E** of `PLAN-CRASH.md` §7 (Claudia creates the GitHub issue).
Branch: `feat/crash-worker`, from `feat/crash-realtime`.
Status: implemented, PR pending (Claudia commits and opens it).

## Objective

The round worker for the Crash games: open a round, take off, mark the impact, reveal the seed and
settle, publishing each transition (PLAN-CRASH §5.1).

## Why

The REST API (branch D) only reacts to players; something has to drive the shared round forward and
settle the bets that never cashed out. One worker drives both games.

## Scope

In scope: `backend/worker/crash-cycle.ts` + integration test; wiring in `backend/worker/main.ts`.

Out of scope: the realtime bus and stream (branch C, done); the screens (branches F/G).

## Preexisting files touched (additive only)

- `backend/worker/main.ts` — start one crash loop per game and a Redis crash publisher; `stop()` now
  stops every loop and closes both buses.

## Design decisions (DECISIÓN)

- **Cloned from `advanceRaces`.** `advanceCrash(db, game, deps, now?)` is the same one-transition-per-
  transaction state machine (`open -> closed -> resolved -> settled`), parameterised by game. The race
  worker is untouched.
- **One active round per game via advisory lock**, keyed `casino:crash:open:<game>:<schema>` (the user's
  chosen approach), not a unique index. Two games never contend, and the open re-checks under the lock.
- **Timings from the shared constants** (`CRASH_BETTING_WINDOW_MS`, `CRASH_INTERMISSION_MS`), overridable
  in `deps` for tests. No env config (same reason as branch D).
- **Impact timing.** While a round is `closed`, each tick derives the impact point from the seed and
  resolves once `clock >= closes_at + impactAtMs(crash)`. The server never ticks the multiplier.
- **Settlement.** Only bets still `pending` are settled here (a cash-out already settled its bet through
  the API). On an impact they lose (`payout 0`, `result {outcome:"lost"}`); on a cap they are all paid
  20.00x with `scopedKey("crash-payout", ...)` — the same key the cash-out would use, so a bet is paid
  at most once. Batched like race settlement, winners' wallets locked before the house.
- **The worker starts one loop per `CRASH_GAMES` entry** (dino-crash, aviator), sharing the Redis
  publisher; `stop()` awaits them all and closes the crash bus.
- **The `cashout` event is not emitted** (it is optional in PLAN-CRASH §5.4, and the API process has no
  publisher in scope); `crashEventSchema` keeps the variant for the future.

## Tasks

- [x] T1 `crash-cycle.ts` (open/takeoff/impact/settle, advisory lock, cap payout) + integration test.
- [x] T2 Wire the crash loops into `backend/worker/main.ts`.

## Acceptance criteria (letter E)

- One active round per game; resumes rounds after a restart; publishes the live events; the ledger
  balances; there are tests.

## Checks

- `npm run lint` — clean (0 warnings).
- `npm run typecheck` — clean.
- `TEST_DATABASE_URL=... TEST_REDIS_URL=... npm test` — green: shared 219, backend 352, frontend 331.
  No new failures vs the known baseline (0). Crash worker tests: 8 (open→settle, loss, cap pays 20x,
  cashed-out bet untouched, one active round, two games independent, intermission).

## Progress

- Branch `feat/crash-worker` from `feat/crash-realtime`. Both tasks done.
