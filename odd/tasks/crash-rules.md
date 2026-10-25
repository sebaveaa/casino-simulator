# crash-rules

Issue: TBD — letter **B** of `PLAN-CRASH.md` §7 (Claudia creates the GitHub issue).
Branch: `feat/crash-rules`, from `origin/main` at eed7eaf.
Status: implemented, PR pending (Claudia commits and opens it).

## Objective

Pure, verifiable Crash engine rules in `shared/`, and the API contract (Zod schemas and `apiPaths`)
the backend and the two game screens (Dino Crash, Despegue) build on.

## Why

Dino Crash and Despegue are one shared "Crash" engine with two animations (PLAN-CRASH §1). Its impact
point must be pure so the browser verifier (#15) runs the exact server code (README §4.1, §5.3), and
every backend and frontend PR that follows needs one shared contract.

## Scope

In scope: `shared/src/games/crash.ts`, `shared/src/api/crash.ts`, new `apiPaths`, exports, tests.

Out of scope: the migration, the transactional flow and the routes (branch D); the realtime bus and
stream route (branch C); the worker (branch E); the screens (branches F, G).

Design source: `PLAN-CRASH.md` §3 (rules) and §5.2/§5.4 (API and events), kept outside the repo.

## Preexisting files touched (additive only)

- `shared/src/index.ts` — add `export * from "./games/crash";`
- `shared/src/api/index.ts` — add `export * from "./crash";`
- `shared/src/api/paths.ts` — add the five Crash routes under `/games/crash/:game/...`

## Design decisions (DECISIÓN)

- **No change to `game.ts`/`gameIds`.** Unlike Chicken Road, Crash does not implement the single-shot
  `Game<Bet, Result>` interface: its mechanic is a shared round plus a time-based cash-out, not
  `resolve(bet, rng)`. Crash defines its own `CRASH_GAMES = ["dino-crash", "aviator"]`. The ids already
  exist in the backend `BetGame` and in `bets_game_check` (migration 0004), so nothing is needed there.
  This also keeps `game.ts` (not in the allowed-to-touch list) untouched.
- **Impact point** (PLAN-CRASH §3.2): `resolveCrash(rng)` draws `r = rng.int(1_000_000)` and returns
  `floor(99_000_000 / (1_000_000 - r))` clamped to `[100, 2000]`, in BigInt so it is exact.
  `P(reach x) = 0.99 / x` → 1 % house edge. Result is `{ crashHundredths, outcome }` where
  `outcome = "cap"` iff the point reaches 2000 (20.00x); at the cap everyone still in is paid 20.00x
  (PLAN-CRASH §3.5).
- **Multiplier curve** (PLAN-CRASH §3.3): `multiplierAtHundredths(ms) = floor(100 * e^(0.00006*ms))`
  and its inverse `impactAtMs(h) = ceil(ln(h/100) / 0.00006)`. The browser animates with the same
  function; the server never ticks the multiplier. `canCashOut(elapsedMs, crash)` is `elapsedMs < impactAtMs(crash)`.
- **Payout** = `floor(stake * cashoutHundredths / 100)` as `bigint`, stake included. Stakes 10 to 500
  credits (1000 to 50000 minor units).
- **Events in English**, following the race convention: `opened`, `takeoff`, `impact`, `settled`,
  `cashout`. Only interface copy is Spanish. Only `impact` carries the revealed `serverSeed`.
- **`crashEventSchema` lives here (branch B), not in C.** Branch B is "rules **and** contract"; the
  events are part of the contract. Branch C's new bus and stream route import this schema. If preferred,
  it is a single export that can move to a branch-C file later.
- **Round contract** mirrors `raceRoundSchema`: secrets (`serverSeed`, `result`) are absent until the
  round is `resolved`, enforced by a `superRefine`. `closesAt` is the takeoff instant.
- **Task file name**: no GitHub issue number exists yet, so the task file is named by the branch slug
  (`crash-rules`) instead of `<issue>-<slug>`; it links the PLAN-CRASH letter instead.

## Tasks

- [x] T1 Pure rules in `shared/src/games/crash.ts` + tests (`crash.test.ts`).
- [x] T2 Zod contract in `shared/src/api/crash.ts`, `apiPaths`, exports + tests (`crash.test.ts`).
- [x] T3 Final checks and task-file close-out.

## Acceptance criteria (letter B)

- Provably fair impact point with 1 % house edge and 20.00x cap.
- Multiplier curve and its inverse.
- Payout in `bigint`.
- Tests with fixed seeds.
- Zod schemas and `apiPaths`.

## Checks

- `npm run lint`
- `npm run typecheck`
- `TEST_DATABASE_URL=postgres://casino:casino@127.0.0.1:5432/casino TEST_REDIS_URL=redis://127.0.0.1:6379 npm test`

Known baseline (measured on `main` this session): lint clean, typecheck clean, all tests pass
(backend 295, frontend 331, shared green) — zero failures.

## Progress

- Branch `feat/crash-rules` created from `origin/main` at eed7eaf.
