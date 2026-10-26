# crash-load

Issue: TBD — letter **H** of `PLAN-CRASH.md` §7 (Claudia creates the GitHub issue).
Branch: `feat/crash-load`, from `feat/crash-aviator-ui`.
Status: implemented, PR pending (Claudia commits and opens it).

## Objective

A k6 load test that proves the Crash engine holds 100 players cashing out in one round, pays each bet
at most once, and leaves the ledger balanced (PLAN-CRASH §7, letter H).

## Scope

In scope: `load/crash-load.js` (the k6 script) and `load/README.md` (how to run it and the
ledger-balances SQL to run afterwards).

Out of scope: any product code — this branch adds only the `load/` folder.

## Design decisions (DECISIÓN)

- **A new top-level `load/` folder.** The script is plain k6 JavaScript; it is linted by Biome (clean)
  but is outside every workspace `tsconfig`, so it is not typechecked, and it is not in `npm test`
  (it needs the running API and the k6 binary). CI is unaffected.
- **The ledger check is SQL, not k6.** k6 cannot read the database, so "the ledger balances" and "no
  bet paid twice" are four SQL queries in the README, the same invariants the integration tests check
  (README §3.1). The script itself proves single payment from the client side: a bet cashed out twice
  returns the same payout, and the custom metric `crash_double_payout` must stay 0 (a threshold).
- **Expected rejections are not failures.** A round that crashes at 1.00x (immediate impact) or a
  betting window that just closed make the server refuse the bet/cash-out cleanly; the script treats
  those as valid outcomes, so `http_req_failed` stays near zero.

## Tasks

- [x] T1 `load/crash-load.js`: register + fund players (setup), bet, wait for takeoff, cash out twice.
- [x] T2 `load/README.md`: run instructions, variables, and the post-run ledger SQL.

## Acceptance criteria (letter H)

- 100 players in one round with simultaneous cash-outs; no double payout; the ledger balances at the
  end. (The script covers the load and the single-payment client check; the ledger balance is the
  README's SQL, which must return no rows / zero.)

## Checks

- `npm run lint` — clean (the k6 script passes Biome; 0 warnings).
- `npm run typecheck` / `npm test` — unaffected (the `load/` folder is outside the workspaces).
- The script itself needs the k6 binary, which is **not installed in this environment**, so it was
  **not executed here**; run it per the README once the API and worker are up.

## Progress

- Branch `feat/crash-load` from `feat/crash-aviator-ui`. Both tasks done; script not run (no k6 here).
