# 46-chicken-road-ui

Issue: https://github.com/sebaveaa/casino-simulator/issues/46
Branches (stacked):
- PR A: `feat/46-chicken-road-ui`, from `feat/45-chicken-road-routes` at 72afb43 (committed as e6b78bb)
- PR B: `feat/46-chicken-road-page`, from A
- PR C: `feat/46-chicken-road-road`, from B

Status: PR B implemented, commit pending (Juan); PR C not started

## Objective

Make Chicken Road playable as "Cruza la Calle". This covers the ApiClient methods (HTTP and mock), the screen at `/games/mini/chicken-road` with the road and the five panel states, game recovery after a reload, error handling, and the playable card in the Minijuegos hub. `shared/` and `backend/` do not change.

## Why

#44 (rules and contract) and #45 (backend) are done; this is the last Chicken Road issue (PLAN-CHICKEN-ROAD phase 5, Annex A issue 4).

Design source: `DISENO-MINIJUEGOS.md` §2–3, the approved visual spec, kept outside the repo. Its texts are used verbatim.

## Design decisions

- **Three stacked PRs, API first.**
  - A: ApiClient + http + mock, with their tests.
  - B: route, page logic, the five panel states, recovery, errors, page tests, and a plain road.
  - C: road visuals and CSS, animations, the hit state, history pills, and the hub card.
- **The UI never decides the result.** It sends the request, waits for the server, and animates what came back. Buttons are disabled while a request is pending.
- **Seed hash before a game: new `getSeedPair()` in ApiClient.** It calls the existing `GET /rng/seed-pair`, parsed with `seedPairResponseSchema`. The Apuesta state shows the active pair's hash, which is the hash the next game will carry. It is fetched again after every game ends, so the nonce shown is the next one.
- **"¿Cómo se verifica?"** is a `<details>` showing the client seed and the nonce, like roulette's `FairnessDetails`. #15 replaces it with a link to the verifier.
- **Credits** use roulette's `shortCredits` (built on `formatCredits`): "10", "12.50". Multipliers come from integer hundredths: 187 → "1,87x".
- **Money math uses BigInt only.** "Ganancia" is `parseAmount(payout) − parseAmount(stake)`. "Habrías cobrado" is `chickenRoadPayout(parseAmount(stake), lanes)`.
- **The mock mirrors the backend.**
  - It builds the road with `chickenRoad.resolve` over one fixed mock seed pair.
  - It allows one game in progress at a time.
  - A replayed start returns the game as it is now. A replayed step returns the same result.
  - Cash out pays once, and lane 6 pays automatically.
  - `hitLane` never leaves the mock while a game is in progress.
  - Unlike the backend, it has no abandonment timer, and roulette spins do not advance its seed-pair nonce.
- **Telling the 409s apart.** The backend answers every conflict with code `conflict` and an English message, with no sub-code. The page resyncs from the server's state instead of matching message strings:
  - **Start 409:** if there is a current game, restore it with "Ya tienes una partida en curso."; if not, reload the history and go to Apuesta with "Esa partida ya terminó."
  - **Step or cash-out 409:**
    - a) If there is a current game, restore it at its real lane, with no message.
    - b) Otherwise, find the game in the history (limit 20) and show its real final panel (Atropellado, Cobrado or Meta).
    - c) Only if it is in neither, show "Tu partida expiró y se devolvió tu apuesta." and go to Apuesta.
- **Item 7 (seed rotation message):** the frontend has no seed or fairness screen and never calls rotate or client-seed, so nothing changes. When such a screen exists, its 409 should read "Termina tu partida de Cruza la Calle para cambiar la semilla."

## Tasks

PR A:

- [x] T1 `client.ts`: `getSeedPair`, `startChickenRoadGame`, `stepChickenRoadGame`, `cashOutChickenRoadGame`, `getCurrentChickenRoadGame`, `listChickenRoadHistory`. `http.ts` implementation and `http.test.ts` (paths, bodies, headers, parsing, 409).
- [x] T2 `mock.ts` implementation with the shared rules; tests in `mock.chicken-road.test.ts`.
- [x] T3 PR A close-out: lint, typecheck, tests.

PR B:

- [x] T4 Route, `ChickenRoadPage`, `useChickenRoad` (load, actions, pending, balance, seed refresh), `format.ts` with tests (BigInt money, multipliers).
- [x] T5 Panel states (Apuesta, En juego, Atropellado, Cobrado, Meta), the Partida verificable block, and the plain road.
- [x] T6 Error mapping and 409 resync; page tests. PR B close-out.

PR C:

- [ ] T7 Road visuals (grid, lanes, pills, badges, cars, chicken, finish), with only the spec's new greys.
- [ ] T8 Animations (jump, hit, ¡PAF!, reveal pacing), reduced motion, history pills, hub card playable, tests.
- [ ] T9 PR C close-out.

## Acceptance criteria

From the issue (PLAN-CHICKEN-ROAD Annex A, issue 4):

- The five screen states are implemented.
- The game is restored after a reload.
- The balance updates after each bet or cash out.
- It works with the mock and with the real backend.
- Tests exist.

## Checks

PowerShell:

```powershell
npm run lint
npm run typecheck
$env:TEST_DATABASE_URL="postgres://casino:casino@127.0.0.1:5433/casino"; npm test
```

Known flaky tests, outside this issue:
- `RoulettePage.test.tsx`: several tests, "stacks the selected chip…" among them, hit the 5 s timeout under load.
- The backend roulette integration test "keeps the ledger consistent…" can time out under full-suite load.

## Try it in the browser (from PR B on)

With the mock:

```powershell
npm run dev -w frontend
```

Then open http://127.0.0.1:5173/games/mini/chicken-road.

With the real backend, run it from source. Don't build Docker images: they are slow and fill the disk (CONFIGURACION-LOCAL.md).

```powershell
# Terminal 1
docker compose up -d postgres redis; npm run migrate; npm run dev -w backend
# Terminal 2
$env:VITE_API_URL="http://localhost:3000"; npm run dev -w frontend
```

Portal at http://127.0.0.1:5173.

## Delivery

Juan makes the commits, pushes, branches, and opens the PRs: "Part of #46" on A and B, `Closes #46` on C. The agent only edits files and runs checks.

## Progress

- Planned. Branch `feat/46-chicken-road-ui` created by Juan from `feat/45-chicken-road-routes`.
- T1 done. `ApiClient` gains `getSeedPair`, `startChickenRoadGame`, `stepChickenRoadGame`, `cashOutChickenRoadGame`, `getCurrentChickenRoadGame`, `listChickenRoadHistory`. `http.ts` uses `apiPaths` and the shared response schemas; only start sends `Idempotency-Key`. `http.test.ts` (+5 tests) checks the paths, methods, bodies and headers, history with and without `limit`, an in-progress game that leaks `hitLane` rejected as `invalid_response`, and a 409 mapped to `conflict`.
- T2 done. The mock keeps one seed pair and builds the road with `chickenRoad.resolve`. `createMockApiClient` gains an optional `startingBalance`, for the insufficient-balance tests here and in PR B. `mock.chicken-road.test.ts` (11 tests) plays real games and picks roads by playing until one fits, since the mock seed is random. It covers:
  - start, charge, and the fairness that matches `getSeedPair`, with the nonce advancing;
  - a replayed start returning the current lane;
  - a replay of a finished game refused, with no charge;
  - one game in progress;
  - an invalid stake, and a stake above the balance (no nonce burned);
  - step replay, a skipped lane, and an unknown game;
  - loss, with later steps and cash-out refused;
  - a single cash out with exactly one payout transaction;
  - no cash out at lane 0;
  - the automatic payout at the goal;
  - history order, limit and bounds.
  The file was run 8 times in a row, all green.
- T3 done.
  - `npm run lint`: clean (175 files).
  - `npm run typecheck`: clean.
  - Full `npm test` with `TEST_DATABASE_URL` on port 5433:
    - shared: 158 passed;
    - backend: 182 of 183, 0 skipped. The one failure is roulette's "keeps the ledger consistent over wins and losses…", a 5 s timeout under full-suite load; the file passes alone (12/12). Backend is untouched;
    - frontend: 170 of 172. The two failures are 5 s timeouts in `RoulettePage.test.tsx`; the timeouts move between different tests from run to run, alone too (one run 25/25, others 1–2 timeouts). Those tests do not call the new methods.
  - All new tests pass: http 14/14, Chicken Road mock 11/11.
- PR A committed by Juan (e6b78bb). Branch `feat/46-chicken-road-page` created from it.
- T4 done.
  - Route `games/mini/chicken-road` inside `RequireSession`.
  - `ChickenRoadPage`: back link `Minijuegos`, the title row, the `Carretera` section and the `Tu partida` aside.
  - `useChickenRoad`:
    - loads current, history and seed pair, and restores a game in progress;
    - start, step, cash out and play again;
    - one pending request at a time, guarded by a ref as well as state, so a double click in one frame sends once; `pending` is cleared in `finally`;
    - the roulette Idempotency-Key pattern, keyed by stake;
    - `applyBalance` + `refreshBalance` after every answer;
    - history and seed pair refetched after a game ends.
  - `format.ts`: `formatMultiplier` (integers only), `credits` (roulette's `shortCredits`), BigInt `gainOf` and `wouldHaveWon`, and `stakeFromInput` (10–500 in steps of 10).
  - `format.test.ts`: the gain is exact past 2^53, where Number gives 16 instead of 17; the floored "Habrías cobrado".
  - Roulette's error messages moved to `pages/betErrorMessage.ts`, now shared by both pages, with no change in behavior.
  - The mock gains `chickenRoads`, fixed hit lanes for tests, with its own test.
- T5 done.
  - `BetPanel`, `PlayingPanel`, `ResultPanel` and `FairnessBlock`, with the texts verbatim from DISENO §3.
  - At 0 lanes the panel shows "1,00x" and the stake as the possible prize.
  - `Road` (plain): Salida, six lanes with sun/tomato/chalk multiplier pills, the `Carril cruzado` badges, the chicken at start, lane or finish, and the checkered Meta.
  - Base CSS (layout, panel, grid with `min-width: 620px` inside `overflow-x: auto`); the only colors outside the tokens are `#2f2f33` and `#4d4a57`.
- T6 done.
  - Error mapping with the approved texts.
  - A 409 on start: restore the current game, or "Esa partida ya terminó."
  - A 409 on step or cash out: a) restore at the real lane; b) the real final panel from history (limit 20); c) "Tu partida expiró y se devolvió tu apuesta."
  - `ChickenRoadPage.test.tsx` (21 tests) covers:
    - the five states and their texts;
    - start → step → cash out with the multiplier, prize and header balance;
    - a hit on lane 1 without "Habrías cobrado", a hit on lane 3 with it;
    - Meta;
    - no Retirar before lane 1;
    - pending locks, with a double click sending once;
    - restore on load;
    - the next nonce after a game;
    - the amount bounds and quick buttons;
    - the login redirect;
    - every error row, with a), b) for lost, cashed out and goal, and c).
  - Waits in that file allow 4 s, and its tests 15 s: each one plays a whole game through the UI, and the 1 s default failed once under full-suite load.
- PR B close-out.
  - `npm run lint`: clean (187 files).
  - `npm run typecheck`: clean.
  - Full `npm test` with `TEST_DATABASE_URL`, run twice:
    - shared: 158/158;
    - backend: 182/183, 0 skipped (all 60 integration tests ran). The one failure is the known roulette integration timeout, which passes alone;
    - frontend: 199/200 and 197/200. Every new test passed in both runs. The failures are `RoulettePage.test.tsx` 5 s timeouts, and that file passes alone (25/25).
