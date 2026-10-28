# 64-blackjack-ui

Issue: https://github.com/sebaveaa/casino-simulator/issues/64
Branches (stacked):
- PR A: `feat/64-blackjack-client`, from `feat/63-blackjack-routes`
- PR B: `feat/64-blackjack-page`, from A

Status: PR A and PR B implemented and pushed. PRs open together at the end (Juan Sebastián).

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
- **The panel reuses the Cruza la Calle classes** (`cr-panel`, `cr-field`, `cr-quick`, `cr-paytable`, `cr-result-sticker`, `cr-history`) and its `FairnessBlock`, so both stepped games read the same; only the felt and the cards are new (`bj-*`). A shared rename of those classes is left for later, as it touches Chicken Road.
- **Doblar** needs the server's `canDouble` (first two cards) and a header balance that covers the stake again; while the balance loads the button trusts the server, which refuses a double it cannot cover (422, the hand stays as it was).
- **409s resync from the server**, as Chicken Road does: an action 409 shows the hand in progress as it really is, or its settled result from the history (limit 20); a start 409 restores the hand in progress with "Ya tienes una mano en curso." or returns to the form with "Esa mano ya terminó."
- **Playtest feedback (Juan Sebastián).** The result pops up over the felt instead of under it: what the hand left the player with in small light type above, the outcome large. The deal is slower and in table order (player, dealer, player, dealer; later the player's card, then the hole card turns and the dealer draws), planned by the pure `planDeal`; the hook waits for it before the balance, the history and the pop-up, so none gives the result away early. The hole card turns over in 3D in place. Each card snaps with a sound synthesized in Web Audio (no audio file), with a "Sonido" toggle kept in `localStorage`. The table rules sit in two arcs in a green close to the felt, and the felt has a diamond weave and a racetrack line. Lost hands show what they cost in the history. Reduced motion lands every card at once and drops the flip and the pop animation.
- **Card names for screen readers** in Spanish ("As de picas"); the hole card is "Carta oculta". Totals show "7 / 17" while an ace still counts 11.

## Tasks

PR A:

- [x] T1 ApiClient methods in `client.ts` and `http.ts`; the mock in `mock.ts` (`blackjackShoes` option); tests in `http.test.ts` and `mock.blackjack.test.ts`.
- [x] T2 PR A close-out: lint, typecheck, tests.

PR B:

- [x] T3 Route `/games/blackjack`, page logic (`useBlackjack`), states: bet form, player turn, settled hand, recovery; errors (409 resync, 422).
- [x] T4 Table and cards (hole card face down until the end), action bar (Pedir, Plantarse, Doblar), result panel, fairness block, history; lobby card live.
- [x] T5 PR B close-out: lint, typecheck, tests.

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

- Branch `feat/64-blackjack-page` created from PR A.
- T3 done: route `/games/blackjack`; `useBlackjack` (load and restore, start with a kept key after a network failure, actions by `index`, 409 resync for start and actions, play again).
- T4 done: `BlackjackPage`, `Table`, `PlayingCard`, `BetPanel`, `PlayingPanel`, `ResultPanel`, `HandHistory`, `format.ts`; felt and card styles with a staggered deal, off under reduced motion; the lobby card links to `/games/blackjack`. Checked in the browser with the mock: deal, hit, stand, result, history, lobby link, no console errors.
- T5 done. Tests: page (13): layout and bet form, stake bounds, deal with the hole card hidden and the stake charged, stand and win with the dealer revealed, hit then no double, double paid on the doubled total, bust without dealer draws, natural and push, recovery after a reload, no double without balance, 422 keeps the hand, action 409 shows the real result, start 409 restores the hand; format (5); lobby and app tests now expect Blackjack live. A flaky balance assertion in `game.integration.test.ts` (#63) is fixed: hands played out while searching a shoe moved the balance, so the stand and double tests now count from the hand's start; passed 5 runs in a row. Final checks: `npm run lint` clean (259 files); `npm run typecheck` clean; with the database, `npm test` green: shared 239, backend 323 passed and 4 skipped, frontend 365.

- Playtest round: `deal.ts` (+5 tests), `cardSound.ts`, `SoundToggle`, `ResultDialog`; `PlayingCard` with face and back; `Table` with the arc legend and the deal delays; `ResultPanel` reduced to "Jugar otra vez"; history pills with the loss; styles. Page tests (16) now read the result from the pop-up and add: Ver la mesa, the result and balance waiting for the deal, a loss in the history; the dealer's natural reads "21", not "11 / 21". Checked in the browser with the mock: deal order, flip, pop-up, legend, felt, no console errors. Checks: lint clean (264 files), typecheck clean, `npm test` green with the database: shared 239, backend 323 passed and 4 skipped, frontend 373.

## Next step

Rebase the five branches on the latest `main`, run the checks again, and open the stacked PRs in order (#62 → #63 A → #63 B → #64 A → #64 B).
