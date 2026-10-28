# 66-blackjack-shoe

Issue: https://github.com/sebaveaa/casino-simulator/issues/66
Branches: PR A `feat/66-blackjack-shoe-rules`, from `feat/67-blackjack-table-polish` (or `main` once the Blackjack stack merges); PR B `feat/66-blackjack-shoe-backend`, from A; PR C `feat/66-blackjack-shoe-contract`, from B; PR D `feat/66-blackjack-shoe-screen`, from C.
Status: in progress (decisions taken; see Decisions).

## Objective

One Blackjack shoe per player that lasts across hands until the cut card, then is reshuffled. The screen shows how much of the shoe is dealt and plays the shuffle animation (`Shuffle.tsx`) when the server starts a new shoe.

## Why

Playtest round 4 on #65: Juan Sebastián asked for a shoe-progress bar and a long shuffle when the shoe runs out. Today every hand deals from a fresh shoe shuffled from its own nonce (README §4.4), so there is nothing to show.

## Scope

In scope: `shared/src/games/blackjack.ts`, `shared/src/api/blackjack.ts`, migration `0009_blackjack_shoes`, `backend/db/schema.ts`, `backend/games/blackjack/`, the Blackjack part of `frontend/src/api/`, `frontend/src/pages/blackjack/` and `BlackjackPage`, their tests, README §3.4, §4.4, §5.1.

Out of scope: a per-shoe endpoint and the browser verifier (#15); a server seed per shoe revealed at the shuffle; a burn card; a Redis cache of shoes; insurance and surrender.

## Design decisions

- **Shoe = one nonce.** A shoe takes a nonce from the active seed pair when it opens; its order is `shuffleShoe(createRng(HMAC(server_seed, client_seed:nonce)))` and is never stored. Table `blackjack_shoes`: `user_id`, `seed_pair_id`, `nonce`, `cut_card`, `next_card`, `status` (`active` | `finished`), `end_reason` (`cut_card` | `seed_rotated`), timestamps; one active shoe per user (partial unique index).
- **Card offset per hand.** `bets.shoe_id` and `bets.card_offset`; unique `(shoe_id, card_offset)`. The hand keeps the shoe's `seed_pair_id` and `nonce` (composite FK to the shoe), so `rotate`'s in-progress check and `selectHands` work unchanged. `bets_seed_pair_nonce_key` becomes partial (`where shoe_id is null`). Hands from before keep `shoe_id = null`: their own shoe at offset 0.
- **Cut card** `BLACKJACK_CUT_CARD = 234` of 312 (75 %), stored per shoe. A round takes at most `BLACKJACK_MAX_ROUND_CARDS = 2 × 21 + 17 = 59` cards and starts before the cut, so it always fits.
- **Pure, shared `resolve`.** `BlackjackBet` gains `cardOffset`; `resolve` deals `playHand(shuffleShoe(rng).slice(cardOffset), actions)`. `playHand` and `shuffleShoe` do not change; offset 0 reproduces today's fixed seeds.
- **Start** opens or continues the shoe in the bet's transaction, after the funds check (a refused start burns no nonce). It locks the shoe `FOR UPDATE` and its seed pair `FOR SHARE`, so a concurrent `rotate` either commits first (the shoe is retired and a new one opens) or is refused by the hand in progress.
- **Settle** advances `next_card` by the round's card count and finishes the shoe at the cut card, in the settlement transaction. Every payout path goes through `settleHand`, so the shoe advances once per hand.
- **Lock order** `wallets → bets → blackjack_shoes → users → seed_pairs`.
- **Seeds.** Revealed only on rotation, never with a hand in progress (unchanged). Rotation retires the active shoe (`seed_rotated`): its unseen cards become public but are never dealt.
- **Contract.** `blackjackShoeSchema` `{ shoeId, size, cutCard, cardsDealt, reshuffle }` in the start, action and current responses (`null` in current when the next hand opens a new shoe); `fairness` gains `shoeId` (nullable) and `cardOffset`. `cardsDealt` counts the hole card as dealt, never its value.
- **Verifier contract (#15).** Per hand: hash, then `resolve` with `cardOffset`. Per shoe: offsets start at 0 and follow each other with no gaps, so the server cannot skip cards.
- **Screen.** It need not look like a dealing shoe. Proposed: a draw pile of card backs in the design picked with **Mazos**, in Barajar's slot beside it, with the cut card as a sliver inside; it sinks as cards land and refills after the shuffle. A `role="meter"`, not a button. Fallback: a thin meter across the felt under the dealer's header. The shuffle plays from the server's data (`reshuffle`, or a new `shoeId`), not from a click; the Barajar button goes away.

## Tasks

PR A (rules):

- [x] T1 `BLACKJACK_CUT_CARD`, `BLACKJACK_MAX_ROUND_CARDS` and the bound test; `roundCardCount` over a state or a result.
- [x] T2 `cardOffset` in `BlackjackBet`, `validateBet` and `resolve`; tests: offset 0 equals today's fixed seeds, offset k equals the sliced shoe, the worst-case round fits after the cut.

PR B (backend):

- [ ] T3 Migration `0009_blackjack_shoes` and schema types; up, down, up on a scratch database.
- [ ] T4 `takeShoe` and the start at the offset; `shoeOf` from the offset; `settleHand` advances and finishes the shoe.
- [ ] T5 Integration tests: hands continue the shoe; the cut card finishes it and the next hand opens a new one; rotation retires it; concurrent rotate and start; a retried action or start advances once; abandonment advances; the ledger still balances.
- [ ] T6 README §3.4 (diagram), §4.4 (continuous shoe, cut card), §5.1 (a nonce per shoe, offset, rotation retires the shoe).

PR C (contract and mock):

- [ ] T7 `blackjackShoeSchema`, `shoe` in the responses, `fairness.shoeId` and `cardOffset`; contract tests (the in-progress schema still carries no card that is not shown).
- [ ] T8 Backend view and routes return the progress; route tests.
- [ ] T9 Mock: an in-memory shoe per player with the cut card and rotation; `blackjackShoes` still stacks the next hands' cards; client and mock tests.

PR D (screen):

- [ ] T10 Draw pile beside Mazos (in the chosen back, cut-card sliver, cards-left count dropped at phone width, `role="meter"`), sinking in step with the deal plan.
- [ ] T11 Shuffle from `reshuffle` or a new `shoeId`; Barajar removed; mock option `blackjackShoeDealt` to start near the cut; page tests near the cut card; checked in the browser at desktop and phone width.

## Acceptance criteria

From the issue (draft):

- `shared/`: cut card and round bound with a test; `cardOffset` validated and used by `resolve`; today's fixed seeds unchanged at offset 0.
- Migration `0009`: `blackjack_shoes` (one active per player), `bets.shoe_id`/`card_offset`, unique `(shoe_id, card_offset)`, composite FK to the shoe's seed pair and nonce.
- Start opens or continues the shoe in the stake's transaction; a refused start opens none and burns no nonce. Settlement advances it once and finishes it at the cut.
- A rotation concurrent with a start never leaves a hand in progress with its server seed revealed.
- The contract carries shoe progress and `fairness.shoeId`/`cardOffset`, never the cards left.
- The history lets a shoe's continuity be checked.
- The mock mirrors the backend; the screen shows how much of the shoe is left (the pile, beside Mazos, at phone width too) and plays the shuffle when a new shoe starts, from the server's answer, never from a click.
- Tests in every layer; the ledger still balances.
- README §3.4, §4.4 and §5.1 updated.

## Checks

- `npm run lint`
- `npm run typecheck`
- `TEST_DATABASE_URL=postgres://casino:casino@127.0.0.1:5432/casino npm test`

## Decisions

Decided by Juan Sebastián on 2026-10-26 (the proposal's open questions, as proposed):

1. Penetration 75 %: the cut card is card 234 of 312.
2. Rotating the seed pair (or changing the client seed) retires the active shoe; no seed per shoe.
3. The shuffle plays when the result of the hand past the cut closes, or when "Repetir apuesta" is pressed before the deal; and before the deal when a start answers an unexpected `shoeId`.
4. Visual: the draw pile in the Mazos back with the cut card, beside Mazos, replacing Barajar; the full-width bar only if the pile does not fit at phone width.
5. Legacy hands: nullable `shoe_id` and `card_offset`; `not null` only if no environment has Blackjack hands when this ships (ask Vera).
6. No burn card.

Still to check when the PRs open: is migration `0009` still free (Crash branches)?

## Progress

- Outline written; issue #66 opened with the decisions above.
- Visual: the user asked for "a bar with a red line at 75 % for the cut", so the draw pile carries the cut card as a red line.
- T1, T2 done: `BLACKJACK_CUT_CARD` (234) and `BLACKJACK_MAX_ROUND_CARDS` (59) with the bound test; `roundCardCount` (every card on the table); `cardOffset` in `BlackjackBet`, validated below the cut card and used by `resolve` (the shoe from that card on). Tests: offset 0 equals today's fixed seeds, offset 7 equals the sliced shoe, a round takes exactly the first cards of its shoe, a split takes no extra card. Shared: 251 tests pass.
