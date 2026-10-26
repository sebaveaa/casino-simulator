# 63-blackjack-api

Issue: https://github.com/sebaveaa/casino-simulator/issues/63
Branches: PR A `feat/63-blackjack-api`, from `feat/62-blackjack-rules`; PR B `feat/63-blackjack-routes`, from PR A.
Status: PR A implemented and pushed; PR B pending. PRs open together at the end (Juan Sebastián).

## Objective

Backend for Blackjack: start a hand, hit, stand, double, restore the hand in progress, and list the history. Money moves only through `WalletService`. The contract in `shared/` (#62) does not change.

## Scope

In scope: migration `0008_blackjack`, `backend/games/blackjack/`, abandonment, the routes, tests, README §4.4.

Out of scope: the game screen (#64), a worker sweep for hands whose player never returns.

Design source: README §4.4, issue #63, `odd/tasks/62-blackjack-rules.md`, and the Chicken Road backend (`odd/tasks/45-chicken-road-api.md`), which this one mirrors.

## Design decisions

- **Two stacked PRs**, as Chicken Road did. PR A (this branch): migration, game service, abandonment, history, integration tests. PR B: routes, route tests, `moduleRoutes`, README.
- **Migration 0008 only adds the partial unique index** `bets_one_blackjack_in_progress_key`: `bets_game_check` and `BetGame` already accept `'blackjack'`. The Crash branches (#55-#61) add no migration, so 0008 is free; check again before the PRs open.
- **The shoe is not stored while the hand runs** (README §4.4). Each operation recomputes it from `bets.seed_pair_id`, `bets.nonce` and that pair's seeds with `shuffleShoe`, and replays the actions with `playHand`. `result = { playerCards, dealerCards, doubled, outcome }` (card numbers) is written when the hand settles; settled hands are shown from it.
- **Bet row.** `selection = {}`. `actions = [{ action, at }]`, one per action, where `at` is PostgreSQL `now()`. `stake` is the total wagered (README §3.4): the initial stake while the hand runs, doubled when a doubled hand settles. Since a double always ends the hand, the initial stake is `stake / 2` exactly when the actions contain `double`.
- **Lock order wallets → bets**, like Chicken Road: every operation locks the wallet first (`lockBalance`), then the bet `FOR UPDATE`.
- **Idempotent start.** The key is `scopedKey("blackjack-bet", userId, key)`. A replay returns the hand **as it is now**, in either state (the start response allows a settled hand). The same key with a different stake answers 409.
- **A natural settles in the start transaction**: on either side the outcome is known at the deal (the dealer peeks).
- **Action replay by `index`.** An index already played with the same action returns the hand unchanged; with a different action, 409. A new action on a settled hand, a skipped index, or an action `legalActions` refuses (double after a hit) answer 409.
- **Double.** Checked against the locked balance first (422 `insufficient_funds`, hand unchanged), then charged as a `bet` transaction with `scopedKey("blackjack-double", userId, handId)`: one per hand.
- **Single payout.** Natural, last action and abandonment all pay with `scopedKey("payout", userId, handId)`, so a hand is paid at most once. A loss pays nothing (the ledger rejects zero amounts).
- **Abandonment** (README §4.4). `BLACKJACK_ABANDON_MS` (10 min) after the last activity, measured with PostgreSQL `now()`. The player stands and the hand resolves with the normal rules, which is what `blackjack.resolve` does with an open turn. A hand in progress can always stand. Settled by the next Blackjack request of that player, in its own transaction (wired in PR B).
- **One hand in progress per player.** Checked explicitly (409) and backed by the partial unique index.
- **Seed rotation** is already refused while any bet of the active pair is `in_progress` (`postgres-seed-pair-service.ts`, from #45); a test pins it for Blackjack.
- `databaseNow` is imported from the Chicken Road view instead of duplicated.

## Tasks

PR A:

- [x] T1 Migration `0008_blackjack` (partial unique index), registered. Checked up, down, up on a scratch database.
- [x] T2 Game service: start (natural settles at once), actions with replay by `index`, double charge, settlement; view with the shoe recomputed from the seed, current and history. Abandonment: `settleAbandonedHand`. Integration tests.
- [x] T3 PR A close-out: lint, typecheck, tests with the database.

PR B:

- [ ] T4 `routes.ts` for the four endpoints (abandonment settled first), registered in `moduleRoutes`; `routes.test.ts` with `app.inject`.
- [ ] T5 README §4.4: Blackjack rules, flow and abandonment.
- [ ] T6 PR B close-out: lint, typecheck, tests with the database.

## Acceptance criteria

From the issue:

- Each operation is one PostgreSQL transaction with the wallet and the hand locked (wallets → bets).
- Start is idempotent: a retry with the same key returns the hand and charges once.
- A repeated action with the same `index` returns the same state without playing twice; an `index` other than the next answers 409.
- Doubling charges the extra stake once and refuses the action if the balance is short.
- Every hand pays with `payout:<user>:<hand>`: it cannot be paid twice.
- One hand in progress per player (partial unique index).
- The shoe is not stored; it is recomputed from the seed pair and the nonce. The result is stored at settlement.
- An abandoned hand (10 minutes) is not lost: the player stands and the hand resolves normally.
- The seed pair cannot rotate while a hand is in progress.
- Route and integration tests, including the ledger balance.
- The migration is new; no existing one is edited.
- README §4.4 updated.

## Checks

- `npm run lint`
- `npm run typecheck`
- `TEST_DATABASE_URL=postgres://casino:casino@127.0.0.1:5432/casino npm test` (after `docker compose up -d postgres redis` and `npm run migrate`)

## Progress

- Planned. Branch `feat/63-blackjack-api` created from `feat/62-blackjack-rules`.
- T1 done: `0008_blackjack.ts`, registered in `migrations/index.ts`; the index test lists it. Up, down and up checked on a scratch database with `createMigrator`.
- T2 done: `view.ts` (row selection and locks, `initialStake`, `shoeOf`, `replay`, mappers to the API hand, current, history), `game.ts` (`startBlackjackHand`, `actOnBlackjackHand`, `settleHand`), `expiry.ts` (`settleAbandonedHand`); `scopedKey` purposes documented. Integration tests (18): start deals from the seed's shoe and stores no result; a natural settles and pays once; idempotent start returns the current hand, 409 on another stake; one hand in progress; insufficient balance burns no nonce; stake bounds; stand pays as the rules say; hit keeps the turn and forbids double; index replay, 409 on another action or a skipped index; 409 after settlement; double charges once and pays on the doubled total, and replays; double without funds answers 422 and leaves the hand; two concurrent stands pay once; another player's hand is 404; abandonment stands after 10 minutes and not before; current restores the hand; history newest first up to the limit; seed rotation refused mid-hand. Ledger sums checked.
- T3 done. Final checks: `npm run lint` clean (245 files); `npm run typecheck` clean in every workspace; with the database, `npm test` green: shared 239, backend 310 passed and 4 skipped, frontend 331.

## Next step

PR B on `feat/63-blackjack-routes`: the routes (`apiPaths.blackjackHands`, `blackjackCurrent`, `blackjackActions`), each settling an abandoned hand first, route tests, and README §4.4.
