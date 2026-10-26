# 65-blackjack-split

Issue: https://github.com/sebaveaa/casino-simulator/issues/65
Branch: `feat/65-blackjack-split`, from `feat/64-blackjack-page`.
Status: implemented and pushed; the PR opens with the rest of the Blackjack stack (Juan Sebastián).

## Objective

Split pairs in Blackjack, in every layer: pure rules and contract in `shared/`, backend, API client and mock, and the screen. It extends the v1 rules of #62, #63 and #64, which left splitting out.

## Why

Playtest feedback from Juan Sebastián on #64: splitting pairs is expected at a Blackjack table.

## Scope

In scope: `shared/src/games/blackjack.ts`, `shared/src/api/blackjack.ts`, `backend/games/blackjack/`, the Blackjack part of `frontend/src/api/`, `frontend/src/pages/blackjack/` and `BlackjackPage`, their tests, README §4.4.

Out of scope: resplitting, insurance and surrender; the verifier (#15).

## Design decisions

- **One stacked branch over #64**, not edits to the five pushed branches: they stay as reviewed units, and this one PR carries the whole feature. It touches every layer, so it goes with `size:exception`, as #40 did.
- **Rules.**
  - Split needs the first two cards of the same rank (8-8, K-K; not K-Q). Once per round: at most two hands. It charges one more stake.
  - The left hand is played first and draws its second card at once; the right one draws its second card when its turn comes.
  - Split aces take one card each and stand. A 21 after a split is not a natural: it pays 1:1.
  - Double after split is allowed, on each hand's first two cards.
  - If every hand busts the dealer does not draw; otherwise the dealer draws to 17 (S17) and each hand is compared on its own.
- **State.** `playHand` returns `{ playerHands, active, dealerCards, finished }`; each player hand has `cards`, `doubled` and `outcome` (`null` until decided). `finished` replaces the single `outcome` as the end-of-round flag. Each action plays the active hand.
- **Result** (`resolve`, stored in `bets.result`): `{ playerHands: [{ cards, doubled, outcome }], dealerCards }`. `resolve` stands on every hand the actions leave open, which is still the abandonment rule.
- **Payout.** `blackjackHandPayout` is the v1 per-hand payout; `blackjackPayout` adds up the hands. `blackjackWagerCount(actions)` counts the stakes on the table: one, plus one per split and per double.
- **Action shape** (`validateBet`): known actions, at most `BLACKJACK_MAX_ACTIONS` (1 + 2 × 19), and a split only as the first action. Double is no longer only first: after a split each hand may double, which only the cards can tell, so `playHand` checks it.
- **Contract.** A round shows `playerHands` (cards, total, doubled; once settled also outcome and payout) instead of `playerCards`, `playerTotal`, `doubled` and `outcome`. In progress it adds `activeHand` and `canSplit`; it is still strict, with no hole card, dealer total or shoe. A hand waiting for its second card after a split has one card, so totals start at 2.

## Tasks

- [x] T1 Rules and contract in `shared/`: split, two hands, per-hand payout, wager count, action shape; tests with stacked shoes and fixed seeds; contract tests.
- [x] T2 Backend: split charge and per-hand double keys, `bets.stake` as stake × wager count, settlement over the hands, abandonment standing every open hand; integration and route tests.
- [x] T3 Client mock mirroring the backend; tests.
- [x] T4 Screen: two hands with the active one highlighted, Separar, the pop-up and history over the hands; page tests.
- [x] T5 README §4.4; final checks.

## Acceptance criteria

From the issue:

- `playHand`, `legalActions`, `resolve` and the payout support `split` and two hands; tests with stacked shoes and fixed seeds.
- The contract shows the player's hands with their totals, whether each doubled, and once settled each outcome and payout; a round in progress says which hand is played and whether it can split. It still never carries the hole card or the shoe.
- The backend charges the split and each double once (own keys), pays once, and abandonment stands every hand left.
- The mock mirrors the backend; the screen shows both hands, the active one highlighted, the Separar button, and the pop-up with each hand's result.
- Tests in every layer; the ledger still balances.
- README §4.4 updated.

## Checks

- `npm run lint`
- `npm run typecheck`
- `TEST_DATABASE_URL=postgres://casino:casino@127.0.0.1:5432/casino npm test`

## Progress

- Planned. Issue #65 opened; branch `feat/65-blackjack-split` created from `feat/64-blackjack-page`.
- T1 done: rules (`legalActions` with split, `playHand` over two hands, `blackjackHandPayout`, `blackjackPayout` over the hands, `blackjackWagerCount`, action shape, `resolve` standing every open hand) and contract (`playerHands`, `activeHand`, `canSplit`, per-hand outcome and payout). Tests: v1 cases on the new state; split offered on a pair of the same rank only; left hand first and the right one's second card on its turn; each hand settled against the dealer; double after split and no resplit; split aces one card each, 21 there is not a natural; both hands bust and the dealer does not draw; payouts added up; wager count; action shape; fixed seeds unchanged. Contract: split in progress and settled, a decided hand refused in progress, hand counts and card bounds. Shared: 247 tests pass. Backend and frontend follow in T2-T4 on this branch.
- T2 done: `initialStake` is `bets.stake` over the wager count; every action that adds a stake updates `bets.stake` with the actions; split charged with `blackjack-split:<user>:<hand>`, a double with `blackjack-double:<user>:<hand>:<player hand>`, both checked against the locked balance (422, round unchanged); settlement stores `{ playerHands, dealerCards }` and pays the sum once; abandonment stands while the round is open; the view shows `playerHands`, `activeHand`, `canSplit` and each hand's payout. `blackjackPayout` now takes hands without cards. Integration tests (+5): split charged once and replayed, both hands played and paid as the rules say; the right hand waiting with one card and `bets.stake` doubled; a double on each hand after the split; split without funds; abandoned split stands both hands. Abandoned rounds are now looked up by id, since the search for a pair can play more rounds than the history's limit. Route test: split handed over. Passed 6 runs in a row with the database.
- T3 done: the mock plays `split`, charges it and each double once from the balance (422 without funds), pays the sum, and shows `playerHands`, `activeHand` and `canSplit`. Client and mock tests (+2): a split charged, replayed, played hand by hand and paid as the rules say; split without funds. Fixtures moved to `playerHands`.
- T4 done: `planDeal` over the player's hands (a split lands the left hand's new card and the pair's other card; the right hand's second card on its turn); the felt shows two hands side by side, the active one outlined with "Tu turno"; Separar next to Doblar, both needing the server's flag and a balance for one more stake; the pop-up, the panel and the history read a round through `roundSummary` (one hand: its outcome; two: the net); settled totals read as one number. Page tests (+2): Separar only on a pair; a split played hand by hand with each result in the pop-up and the net in the history. Deal tests (+1): the split. Checked in the browser with the mock: split aces and a split played hand by hand; on a clean reload, dozens of rounds with no console errors.
- T5 done: README §4.4 (split rules, charges, payout over the hands, abandonment of every open hand). Final checks: `npm run lint` clean (264 files); `npm run typecheck` clean; with the database, `npm test` green: shared 247, backend 329 passed and 4 skipped, frontend 378.

## Next step

Open the stacked PRs in order with the rest of Blackjack: #62 → #63 A → #63 B → #64 A → #64 B → #65 (`size:exception`).
