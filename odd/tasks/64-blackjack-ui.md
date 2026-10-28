# 64-blackjack-ui

Issue: https://github.com/sebaveaa/casino-simulator/issues/64
Branches (stacked):
- PR A: `feat/64-blackjack-client`, from `feat/63-blackjack-routes`
- PR B: `feat/64-blackjack-page`, from A

Status: PR A implemented and pushed; PR B pending. PRs open together at the end (Juan Sebastián).

## Objective

Make Blackjack playable from the lobby: the ApiClient methods (HTTP and mock), the screen at `/games/blackjack` with its states, hand recovery after a reload, error handling, and the lobby card turned from "¡Pronto!" to "¡Jugar!". `shared/` and `backend/` do not change.

## Why

#62 (rules and contract) and #63 (backend) are done; this is the last Blackjack issue.

Design source: issue #64, the Arcade identity of the lobby (#21), and the Chicken Road screen (`odd/tasks/46-chicken-road-ui.md`), which this one mirrors.

## Design decisions

- **Two stacked PRs, API first.**
  - A: ApiClient + http + mock, with their tests.
  - B: route, page logic and states, cards and table, recovery, errors, history, fairness block, lobby card, page tests.
- **Method names** follow Chicken Road: `startBlackjackHand`, `playBlackjackAction`, `getCurrentBlackjackHand`, `listBlackjackHistory`. Only the start sends an `Idempotency-Key`; an action is made idempotent by its `index`.
- **The mock mirrors the backend (#63).**
  - It shuffles the shoe with `shuffleShoe` over the mock seed pair Chicken Road already uses, so both games advance one nonce.
  - It replays the hand with `playHand` and builds the view the backend builds: in progress, only the dealer's up card.
  - One hand in progress; a replayed start returns the hand as it is now; an index already played replays, another action on it or a skipped index is 409.
  - A natural settles at the start; a double charges the stake once (422 without funds, hand unchanged); a hand pays once.
  - Unlike the backend, it has no abandonment timer.
- **`blackjackShoes` fixes the deal** in the mock, as `chickenRoads` fixes the road: the stacked shoe of each next hand. Once it runs out, the seed decides again. Page tests and manual checks of each state use it.
- **The UI never decides the result.** It sends the action, waits for the server, and animates the cards that came back. Buttons are disabled while a request is pending.

## Tasks

PR A:

- [x] T1 ApiClient methods in `client.ts` and `http.ts`; the mock in `mock.ts` (`blackjackShoes` option); tests in `http.test.ts` and `mock.blackjack.test.ts`.
- [x] T2 PR A close-out: lint, typecheck, tests.

PR B:

- [ ] T3 Route `/games/blackjack`, page logic (`useBlackjack`), states: bet form, player turn, settled hand, recovery; errors (409 resync, 422).
- [ ] T4 Table and cards (hole card face down until the end), action bar (Pedir, Plantarse, Doblar), result panel, fairness block, history; lobby card live.
- [ ] T5 PR B close-out: lint, typecheck, tests.

## Acceptance criteria

From the issue:

- API client (HTTP and in-memory mock) for the four endpoints, with tests.
- Route `/games/blackjack`; the lobby card goes from "¡Pronto!" to "¡Jugar!".
- Screen states: bet form, player turn, settled hand (outcome and payout), and recovery of the hand in progress after a reload.
- Pedir, Plantarse and Doblar; Doblar only with the first two cards and enough balance.
- The dealer's hole card stays face down until the hand ends.
- Fairness block (seed hash, client seed and nonce) and the latest hands.
- The header balance follows every response.
- Spanish copy; tests of the components and the state logic.

## Checks

- `npm run lint`
- `npm run typecheck`
- `npm test`

## Progress

- Planned. Branch `feat/64-blackjack-client` created from `feat/63-blackjack-routes`.
- T1 done: four methods on `ApiClient`, parsed with the shared schemas in `http.ts`; the mock (`MockBlackjackHand`, `blackjackView`, settlement once, `blackjackShoes`). HTTP tests (5): start with the key, action by id and index without a key, current and history paths, a leaked hole card is an `invalid_response`, 422 mapped. Mock tests (11): start and up card only, natural pays 3:2 once, replayed start, one hand and stake bounds, stand and dealer to 17, hit and index replay with 409s, double charged once and replayed, double without funds, 404 and 409 after settlement, seed deal after the fixed shoes, history order and limits.
- T2 done. Final checks: `npm run lint` clean (248 files); `npm run typecheck` clean in every workspace; `npm test` green: shared 239, backend 323 passed and 4 skipped (with the database), frontend 347.

## Next step

PR B on `feat/64-blackjack-page`: the screen, built on these methods.
