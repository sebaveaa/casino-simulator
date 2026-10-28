# Crash load test (k6)

`crash-load.js` drives a crowd of players into one Crash round, bets for each, and cashes them all
out at takeoff, to show the engine holds 100 simultaneous cash-outs and that a bet is paid at most
once (PLAN-CRASH §7, letter H). It is **not** part of `npm test`: it needs the running API and the
[k6](https://k6.io) binary.

## Run it

Bring up the backend and databases (see `AGENTS.md`), then:

```bash
# Databases + a migrated schema
docker compose up -d postgres redis
npm run migrate

# The API and the worker (two terminals), from source
npm run dev -w backend                       # PROCESS_ROLE=api by default
PROCESS_ROLE=worker npm run dev -w backend    # opens and settles the rounds

# The load test: 100 players, 3 rounds each
k6 run -e API_URL=http://localhost:3000 -e PLAYERS=100 load/crash-load.js
```

Variables: `API_URL`, `PLAYERS` (default 100), `ROUNDS` (per player, default 3), `CRASH_GAME`
(`dino-crash` or `aviator`), `STAKE` (minor units, default `1000` = 10 credits).

## What it checks

- Every bet is either placed (201) or cleanly refused (409 already bet this round, 400 the window
  closed) — never a 5xx.
- Every cash-out is paid (200) or arrives after the crash (400) — both valid.
- A bet cashed out twice returns the **same** payout the second time (the custom metric
  `crash_double_payout` must stay `0`, enforced by a threshold).
- `http_req_failed` stays under 2 % and `checks` over 98 %.

## The ledger must balance (run after the test)

k6 cannot read the database, so confirm the money invariants with SQL against the test database
(README §3.1). All four queries must return **no rows / zero**:

```sql
-- 1. Every transaction's entries sum to zero (double-entry).
select transaction_id from ledger_entries group by transaction_id having sum(amount) <> 0;

-- 2. Every wallet balance equals the sum of its ledger entries (no drift).
select w.id from wallets w
  left join ledger_entries e on e.wallet_id = w.id
  group by w.id, w.balance having w.balance <> coalesce(sum(e.amount), 0);

-- 3. The whole system nets to zero (credits only move, never appear).
select coalesce(sum(balance), 0) as total from wallets;   -- expect 0

-- 4. No bet was ever paid twice.
select bet_id from transactions where type = 'payout' and bet_id is not null
  group by bet_id having count(*) > 1;
```

One-liner against the Docker database:

```bash
docker compose exec -T postgres psql -U casino -d casino -c "select coalesce(sum(balance),0) as total from wallets;"
```
