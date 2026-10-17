# 38-roulette-multi-bet

Issue: https://github.com/sebaveaa/casino-simulator/issues/38
Branch: feat/38-roulette-multi-bet (from `feat/12-roulette-bets` at 62d9566; PR #37 into `main` is still open)
Status: planned

## Objective

Several roulette bets on one spin, and the table redesign settled by the UI prototype on `prototype/12-roulette-table` (variant C: classic felt, stackable chips, ball wheel in the Casino Cloud theme).

## Why

`POST /games/roulette/bets` takes one selection per request, so the table allows a single bet and never shows the total staked or the possible win.

## Scope

In scope: multi-selection spin rules in `shared/`, the bet contract and endpoint, the mock API, the table UI from variant C, the ball-animated wheel with the Casino Cloud theme, README §3.2–§3.4, §4.1–§4.2, §5.1, §5.3.

Out of scope: the browser verifier screen (#15), new bet types (splits, columns, high/low), the Clásica/Lujo wheel themes and the brand felt from the prototype, slots.

## Design decisions

- `Game<RouletteBet, RouletteResult>` stays as is: one selection is still a valid `Game`, and `resolve` ignores the bet. A spin layer in `shared/src/games/roulette.ts` adds `validateSpin` (1..44 bets, distinct selections, each bet valid, total stake and total payout within `MAX_MONEY`) and `spinPayouts` (per-bet payout and total).
- Request: `{ bets: [{ stake, selection }] }`. Response: `{ betId, result, bets: [{ stake, selection, payout }], stake, payout, balance, fairness }` with totals as strings. The 44-bet cap is the number of distinct selections the rules allow (37 numbers + 7 outside bets).
- One spin = one `bets` row, one seed-pair draw, one nonce. `bets.selection` (jsonb) stores the list; `stake` and `payout` hold the totals. No migration: PR #37 is not merged, so no deployed row holds the single-selection shape.
- Ledger: one `bet` transfer for the total stake and one `payout` transfer for the total payout (skipped when 0), as today. Entries still sum to zero per transaction.
- Idempotency: one key per spin. Replay compares the stored list with the request in order; any difference answers 409 `conflict`.
- Insufficient funds for the total stake rejects the whole spin before the draw.

## Tasks

- [x] T1 Multi-bet contract end to end: shared spin rules and API schemas with tests; backend route, `placeRouletteBet` and replay with route and integration tests; mock API and tests; `RoulettePage` sends a one-element list (UI unchanged); README sections. Route: delegated (writer trigger: 3+ non-trivial files). Forecast ~450 lines.
- [ ] T2 Table UI from variant C: classic felt layout, chip rack 1/5/10/25/100, Deshacer/Limpiar/Repetir/Doblar, summary under the wheel (staked, max win, bet count, balance after), x2/x3/x36 badges, stepped result (+won, −staked, = net), legible history, 1440×900 without scroll; page tests. Route: delegated (writer trigger). Forecast ~600 lines.
- [ ] T3 Ball wheel: PixiJS ball animation landing on the server number, Casino Cloud theme from the style tokens, reduced-motion fallback; replaces `wheelScene`; pure helpers tested. Route: delegated (writer trigger). Forecast ~450 lines.

## Acceptance criteria

Issue #38 criteria, all of them.

## Checks

`npm run lint`, `npm run typecheck`, `npm test` (with `TEST_DATABASE_URL` against the compose Postgres after `npm run migrate`), `npm run build -w backend`, `npm run build -w frontend`.

## TDD

Mode: off. Source: carried from the user's choice on #12, #11, #10 and #9 (no project-level setting). Runner: Vitest.

## Review

Native review only for large feature merges (user preference); work units are left unreviewed until the feature PR.

## Delivery

Forecast: ~1500 authored lines (T1 ~450, T2 ~600, T3 ~450). Strategy: ask-on-risk. Chain strategy: feature-branch-chain (user's choice, 2026-10-17). One PR per task: T1 → `feat/12-roulette-bets`, T2 → T1's branch, T3 → T2's branch.

## Progress

- Planned. Branch created from `feat/12-roulette-bets` (62d9566). Exploration: delegated mapper.
- T1 done (this commit, +523/−107 over 13 files, above the ~450 forecast mostly from tests and README): `validateSpin`, `spinPayouts`, `totalStake`, `selectionKey`, `MAX_SPIN_BETS` in shared; request `{ bets }`, response with per-bet payouts and totals; one `bets` row per spin with the list in `selection` (serialized with `JSON.stringify`, since the driver would send a JS array as a PostgreSQL array); ordered replay comparison, 409 otherwise; mock API with the same contract and a 409 on key reuse; page sends a one-element list; README §3.2–§3.4, §4.1–§4.2, §5.1, §5.3. Checks: format, lint, typecheck pass; `TEST_DATABASE_URL=… npm test` (compose Postgres on host port 5433) backend 130, shared 152, frontend 98 passed, integration tests included; `npm run build -w backend` and `-w frontend` pass. Route: delegated writer. Review: deferred to the T1 PR slice.

## Next step

Open the T1 PR into `feat/12-roulette-bets` (awaiting the user's go-ahead), then T2 on a branch from this one.
