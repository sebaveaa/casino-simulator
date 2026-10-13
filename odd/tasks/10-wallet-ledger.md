# 10-wallet-ledger

Issue: https://github.com/sebaveaa/casino-simulator/issues/10
Branch: feat/10-wallet (feature base); slices feat/10-wallet-0N-*
Status: slices complete, final review approved, PRs open

## Objective

Implement `WalletService`: the double-entry ledger that every money movement goes through (README §3), the simulated `PaymentProvider` deposit, the wallet endpoints, and the wallet page.

## Why

Wallet is the core of the MVP chain (#10 → #9 → #11 → one game). #9 registration calls `createPlayerWallet`, and every game moves money through `transfer`.

## Scope

In scope: `PostgresWalletService`, `SimulatedPaymentProvider`, PostgreSQL integration tests and a CI Postgres service, `GET /wallet/balance`, `POST /wallet/deposits`, `GET /wallet/transactions`, the wallet page, and balance refresh in the shell.

Out of scope: withdrawals, deposit limits (only the existing `MAX_MONEY` schema cap), auth (#9; guarded routes answer 501 at runtime until the token service exists, and tests inject a fake `TokenService`).

## Design decisions

- `transfer` resolves both wallets, locks them with `SELECT … FOR UPDATE` in id order (no deadlocks between opposite transfers), checks that a player wallet stays non-negative (`InsufficientFundsError`), inserts the transaction and both entries, and updates both balances, all on the caller's executor.
- Deposit idempotency: lock the player wallet first, then `findTransaction(scopedKey("deposit", user, key))`. Keys are scoped by user, so the lock serializes concurrent retries of one key; no unique-violation race inside the transaction.
- `bigint` stays `BigInt` from the pg parser (`backend/platform/postgres.ts`); routes convert with `toAmount` and `toISOString`.
- History cursor: opaque base64 of `(created_at, id)`, keyset ordering `created_at desc, id desc`. Migration `0002` adds the matching `ledger_entries (wallet_id, created_at desc, id desc)` index; `0001` stays untouched.
- Integration tests run against a real database when `TEST_DATABASE_URL` is set and are skipped otherwise; CI adds a `postgres:17-alpine` service and runs migrations first. Each test creates its own users, since append-only triggers forbid cleanup by DELETE.
- Frontend: a deposit keeps one `Idempotency-Key` per submitted amount, so a retry after a network error charges once. `BalanceProvider` gains `refresh()`.

## Tasks

- [x] T1 `PostgresWalletService` (all six methods) and `SimulatedPaymentProvider`, migration `0002` index, integration tests (zero-sum entries, concurrent debits without double spend, idempotent deposit retry, insufficient balance, history paging), CI Postgres service, README/AGENTS test command. Route: delegated (writer trigger: 4+ non-trivial files).
- [x] T2 Wallet routes in `moduleRoutes`, wiring of real wallet and payments in `main.ts`, route tests through `app.inject` with a fake `TokenService` (balance, deposit with idempotent retry, missing key 400, history paging, 401). Route: delegated (writer trigger: 3+ non-trivial files).
- [x] T3 Wallet page (balance, deposit form, history with "load more"), `BalanceProvider.refresh()`, Spanish UI copy, component tests against the mock API. Route: delegated (writer trigger: 3+ non-trivial files).

## Acceptance criteria

Issue #10 criteria, all eight.

## Checks

`npm run lint`, `npm run typecheck`, `npm test` (with `TEST_DATABASE_URL` set against the local compose Postgres after `npm run migrate`), `npm run build -w backend`.

## TDD

Mode: off. Source: carried from the user's choice on #25 (no project-level setting). Runner: Vitest.

## Review

Native review only for large feature merges (user preference); small work units are left unreviewed.

## Delivery

Forecast: ~1,100 authored lines (T1 ~500, T2 ~300, T3 ~300).
Strategy: ask-on-risk. Chain strategy: feature-branch-chain (user choice). Slice PRs target `feat/10-wallet`; one final PR merges `feat/10-wallet` into `main` and closes #10.

| Slice | Branch | Base | Tasks | Forecast |
|-------|--------|------|-------|----------|
| 1 | feat/10-wallet-01-ledger | feat/10-wallet | T1 | ~500 |
| 2 | feat/10-wallet-02-endpoints | slice 1 | T2 | ~300 |
| 3 | feat/10-wallet-03-page | slice 2 | T3 | ~300 |

## Progress

- Planned. Branch `feat/10-wallet-01-ledger` created from `main` (f296780).
- T1 done (delegated writer, route: delegated). Commit: see `git log` on `feat/10-wallet-01-ledger`. Checks: migrate twice (second no-op), lint, typecheck, build clean; `npm test` 81 passed with `TEST_DATABASE_URL` (11 integration tests ran), 70 passed and 11 skipped without. Cursor carries `created_at` as UTC ISO with microseconds so keyset paging is exact.
- T2 done (delegated writer). Checks: format/lint/typecheck/build clean; `npm test` 94 passed with `TEST_DATABASE_URL` (12 gated tests ran, incl. 1 route e2e), 82 passed and 12 skipped without. Deposit answers 201 (a retry returns the same body). Diff: 4 files, +358/-2 (routes.ts 58, routes.test.ts 291). Guarded routes still answer 501 at runtime until #9.

- Native review of slices 1-2: lineage `review-f9f42597570f236a`, high risk, 4 lenses, approved and acknowledged (authority burned), no correction.
- T3 done (delegated writer). Checks: format/lint/typecheck clean; `npm test` 82 passed and 12 skipped (backend, no `TEST_DATABASE_URL`), 45 passed (frontend); `npm run build -w frontend` clean. Diff: 7 files, +607/-14.
- Slice 3 native review: medium risk, declined by the user for this candidate.
- Final native review of the whole feature (`f296780..a8cb6d3`, 19 files, 1544 lines): lineage `review-43bd4a5ee57a2bc3`, high risk, 4 lenses, approved and acknowledged (authority burned), no correction.

## Advisory findings (non-blocking, open)

- R1 WARNING: deposits have no cap below `MAX_MONEY` (int64 max), so two huge deposits overflow the shared issuance balance and every later deposit fails with 500; reachable once #9 lands. Fix with a per-deposit cap (`backend/payments/simulated-payment-provider.ts`).
- R3 WARNING: a deposit retry with the same Idempotency-Key but a different amount returns the original transaction instead of rejecting with 409/422 (`backend/payments/simulated-payment-provider.ts`).
- R3 WARNING: a deposit retry returns the current balance, not the original response's balance (`backend/wallet/routes.ts`).
- R4 WARNING: every transfer locks and updates the single house/issuance wallet row, serializing all bets and deposits system-wide (`backend/wallet/postgres-wallet-service.ts`).
- R3 SUGGESTION: a cursor with an out-of-range timestamp yields 500 instead of 400.
- R3 SUGGESTION: no route test for a missing wallet.
- R2 SUGGESTION: cursor `id` is the ledger entry id, name it so; misleading transaction count in an integration test.
- R4 SUGGESTION: migration 0002 builds the index without CONCURRENTLY.
- R3/R4 SUGGESTION: wallet page "load more" can race a history reload and append stale rows; balance refresh can overwrite a newer value.
- R2 SUGGESTION: duplicated balance fetch in `useBalance.tsx`; name the player-only overdraft rule.

## Next step

Merge the slice PRs into `feat/10-wallet` in order, then open the final PR to `main` (Closes #10). Decide on the advisory warnings (R1 deposit cap first) before or right after #9.
