# 65-blackjack-split

Issue: https://github.com/sebaveaa/casino-simulator/issues/65
Branch: `feat/65-blackjack-split`, from `feat/64-blackjack-page`.
Status: in progress

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
- [ ] T2 Backend: split charge and per-hand double keys, `bets.stake` as stake × wager count, settlement over the hands, abandonment standing every open hand; integration and route tests.
- [ ] T3 Client mock mirroring the backend; tests.
- [ ] T4 Screen: two hands with the active one highlighted, Separar, the pop-up and history over the hands; page tests.
- [ ] T5 README §4.4; final checks.

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
