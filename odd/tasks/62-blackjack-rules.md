# 62-blackjack-rules

Issue: https://github.com/sebaveaa/casino-simulator/issues/62
Branch: `feat/62-blackjack-rules`, from `main` at eed7eaf.
Status: implemented; push and PR pending (Juan Sebastián)

## Objective

Pure, verifiable Blackjack rules in `shared/`, and the API contract (Zod schemas and `apiPaths`) the backend (#63) and the game screen (#64) build on.

## Why

Blackjack is the stateful game of README §4.4. Its rules must be pure so the browser verifier (#15) runs the exact server code (README §4.1, §5.3), and the backend and frontend PRs that follow need one shared contract.

## Scope

In scope: `shared/src/games/blackjack.ts`, `shared/src/api/blackjack.ts`, new `apiPaths`, exports, tests.

Out of scope: the migration, the transactional flow, abandonment and the routes (#63); the game screen (#64); split, insurance and surrender (not in v1).

Design source: README §4.4 and §5.1, issue #62, and the Chicken Road contract (#44), which this one mirrors.

## Design decisions

- **Rules v1.** Six-deck shoe; deal order player, dealer, player, dealer (the dealer's second card is the hole card); the dealer peeks, so a dealer natural ends the hand at once; a player natural pays 3:2; the dealer stands on every 17 (S17); actions `hit`, `stand` and `double` (first two cards only, one card, then the hand stands); 21 stands automatically; a bust loses without the dealer drawing. Stakes from 10 to 500 credits.
- **Cards are integers.** A card is `0..51`: rank `card % 13` (ace first) and suit `floor(card / 13)`. The shoe is the six decks `0..311` mapped to `i % 52`. The API sends `{ rank, suit }`; `describeCard` converts.
- **`resolve` shuffles the whole shoe with Fisher-Yates** (`rng.int(i + 1)` for `i = 311 … 1`). 311 draws cost a few SHA-256 blocks, and an unbiased full shuffle is easier to verify than a partial one. The shoe is never stored: the backend recomputes it from the seed pair and the nonce.
- **A hand fits `Game` through its actions.** `BlackjackBet = Wager & { actions }`, with `stake` the initial stake. `playHand(shoe, actions)` replays the hand and may leave it on the player's turn; `resolve` stands for the player when the actions leave the turn open, which is exactly the abandonment rule of README §4.4. So every bet resolves to a finished hand.
- **Legality.** `validateBet` checks the stake and the shape of the actions (`double` only first; nothing after `stand` or `double`). Card-dependent legality (no action after 21 or a bust, no action after a natural) is checked by `playHand`, which throws, and `legalActions(state)` tells the backend what the next action may be.
- **Payout in integers**, stake included: natural `floor(stake * 5 / 2)`, win `2 × wagered`, push `wagered`, any loss `0`, where `wagered` is the stake, doubled after `double`.
- **Exports are prefixed** (`BLACKJACK_MIN_STAKE`, …), because `shared/src/index.ts` re-exports every game and Chicken Road already exports `MIN_STAKE` and `MAX_STAKE`.
- **A hand in the API is a union on `status`**: `player_turn` (strict: never carries the shoe, the hole card or a dealer total) and `settled` (every card, both totals, outcome and payout). With "no current hand" (the bet form) they cover the screen states.
- **Actions name the hand and their position** (`handId`, `index`, starting at 0). A retried or double-clicked action with the same `index` replays instead of playing twice.
- **History**: `GET /games/blackjack/hands?limit=` (default 5, at most 20) returns the latest settled hands, newest first.
- `fairnessSchema` is reused from `api/roulette.ts`, so the verifier reads the same fields for every game.

## Tasks

- [x] T1 Pure rules in `shared/src/games/blackjack.ts`: cards, hand value, shuffle, `playHand`, `legalActions`, payout, `blackjack: Game`; exported from `index.ts`; tests with stacked shoes, a fake `Rng` and fixed seeds.
- [x] T2 Zod schemas in `shared/src/api/blackjack.ts` (start, action, current, history), `apiPaths`, exports; tests.
- [x] T3 Final checks and task file close-out.

## Acceptance criteria

From the issue:

- `blackjack` implements `Game<BlackjackBet, BlackjackResult>`.
- `resolve` is pure and tested with fixed seeds.
- Hand value, natural, `playHand` and every payout are tested.
- Payouts are `bigint`, with no floats.
- Zod schemas and `apiPaths` exist; a hand in progress never carries the shoe or the hole card.
- Amounts travel as strings.

## Checks

- `npm run lint`
- `npm run typecheck`
- `npm test`

## Delivery

Size: 925 added lines: 392 of rules and contract, 460 of tests, 73 of this file. Above the 400-line guide, like #44; splitting rules from contract would leave the contract PR without the types it imports. Strategy: `single-pr` to `main`; #63 stacks on it. Commit after each task; Juan Sebastián reviews before the push and the PR (`Closes #62`).

## Progress

- Planned. Branch `feat/62-blackjack-rules` created from `main`.
- T1 done: `games/blackjack.ts` (config, ranks and suits, `describeCard`, `handValue`, `isNatural`, `shuffleShoe`, `playHand`, `legalActions`, `blackjackPayout`, `isValidBlackjackStake`, `blackjack`), exported from `index.ts`. `"blackjack"` was already in `gameIds`. Tests: card mapping, soft and hard totals, naturals, the shoe holds each card six times and draws `rng.int(312 … 2)`, deal order, naturals on either side, dealer to 17 and S17, totals compared, bust without dealer draws, auto stand on 21, double (win and bust), double after a hit refused, shoe exhaustion, every payout (3:2 rounded down, doubled), stake and action-shape validation, fixed seeds (nonce 0 and 2), outcome depends on the actions, implicit stand. Checks: Biome, typecheck, shared tests pass.
- T2 done: `api/blackjack.ts` with the card schema, the hand union (`player_turn` strict, `settled`), start/action/current/history request and response schemas, the stake bounds refined on the start request, `index` bounded by `BLACKJACK_MAX_ACTIONS`, and the history query (`limit` coerced, default 5, max 20); three `apiPaths` entries; exported from `api/index.ts`. Tests: every card `describeCard` builds, each state, hole card, dealer total, shoe and outcome rejected in progress, values that do not fit a hand, stake bounds and malformed stakes, start answers in progress or settled, action names and index bounds, current is in progress or null, history limits and settled hands only, the paths. Checks: Biome, typecheck, shared tests pass.
- T3 done. Final checks: `npm run lint` clean (240 files); `npm run typecheck` clean in every workspace; `npm test` green: shared 239, backend 173 passed and 122 skipped (no database), frontend 331.

## Next step

Juan Sebastián reviews the diff, pushes and opens the PR (`Closes #62`) to `main`. #63 branches from this one: migration `0008_blackjack` (one hand in progress per player), the game service with the shoe recomputed from the seed, the action replay by `index`, the double charge and abandonment by auto stand.
