# platform-hardening

Issue: none (user decision, 2026-10-11: fix directly, no follow-up issue).
Branch: `fix/platform-hardening`
Status: in progress

## Objective

Fix the four priority advisory findings from the bootstrap review (lineage `review-332d389b222dc301`), so the skeleton the team builds on does not crash, leak or expose services.

## Why

- The pg `Pool` has no `'error'` listener: an idle client error is an unhandled `'error'` event and kills the process.
- The `/health` PostgreSQL ping times out with `withTimeout` but never releases or aborts the query, so a hung database leaks pool clients until the pool is exhausted.
- The Redis `'error'` listeners in the API and the worker are empty: errors are swallowed and a broken worker leaves no trace.
- Compose publishes PostgreSQL, Redis and the app on every host interface, exposing them to the local network.

## Scope

- `docker-compose.yml`: publish ports on `127.0.0.1` only.
- `backend/platform/postgres.ts` and its health ping: pool `'error'` listener that logs; a ping that cannot leak a client past its timeout.
- `backend/platform/redis.ts`, `backend/worker/main.ts` and the API wiring: Redis errors are logged, not swallowed.
- Tests for the new behavior.

Out of scope: the other seven advisory findings (JWT placeholder in production, liveness vs readiness split, timeout naming, `withTimeout` and config test gaps).

## Tasks

- [x] T1 Record the bootstrap delivery in `odd/tasks/2-project-bootstrap.md` (merges, review outcome, advisory findings).
  Route: inline. One mechanical doc edit.
- [x] T2 Compose: bind `postgres`, `redis` and `app` ports to `127.0.0.1`.
  Route: inline. One mechanical file.
- [ ] T3 PostgreSQL: pool `'error'` listener that logs; health ping that releases or aborts its client on timeout; tests.
  Route: delegated. Writer trigger: 2+ non-trivial files (T3 and T4 share one writer).
- [ ] T4 Redis: log `'error'` events in the API and worker instead of swallowing them; tests.
  Route: delegated, same writer as T3.

## Acceptance criteria

- An idle pg client error is logged and the process keeps running.
- A health ping that times out leaves no checked-out pool client behind.
- A Redis error in the API or the worker produces a log line.
- `docker compose config` publishes every port on `127.0.0.1`.
- `npm run lint`, `npm run typecheck` and `npm test` pass; `GET /health` still returns 200 against the real compose stack.

## Checks

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `docker compose config`
- Real stack: `docker compose up -d`, backend dev server, `GET /health` returns 200.

## TDD

Mode: off. Source: explicit user choice for this project, 2026-10-11. Runner: Vitest. Ordinary functional checks run per task.

## Review

Per the user, native review runs only for large feature merges. This fix is small; work units are recorded as "review skipped: user left candidate unreviewed".

## Delivery

Forecast: about 150 authored changed lines, under the 400-line budget. Strategy: `single-pr`.

## Progress

- Bootstrap PR #3 merged to `main` as 9d3aeaf; issue #2 closed; tracker branch deleted locally and on the remote. Branch `fix/platform-hardening` created from 9d3aeaf.

- T1 done: `2-project-bootstrap.md` records merges, review lineage, advisory findings and the #3 merge; structural readback of the diff. Commit 31b5557. Review: skipped, passive doc edit.
- T2 done: compose publishes `postgres`, `redis` and `app` on `127.0.0.1`. Check: `docker compose --profile app config` shows `host_ip: 127.0.0.1` on all three ports. Review: skipped, user left candidate unreviewed.

## Next step

T3 and T4 (one delegated writer).
