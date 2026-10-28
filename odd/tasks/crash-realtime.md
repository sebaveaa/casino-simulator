# crash-realtime

Issue: TBD — letter **C** of `PLAN-CRASH.md` §7 (Claudia creates the GitHub issue).
Branch: `feat/crash-realtime`, from `feat/crash-api`.
Status: implemented, PR pending (Claudia commits and opens it).

## Objective

A realtime channel for the Crash games: a Redis pub/sub event bus and an SSE stream route, **cloned**
from the race realtime into new, parallel files, never editing the race ones (PLAN-CRASH §5, §5.4).

## Why

The screens need to know when a round opens, takes off, crashes and settles without polling. The worker
(branch E) publishes these events; the API streams them to the browser.

## Scope

In scope: `backend/realtime/crash-events.ts`, `backend/realtime/redis-crash-events.ts`,
`backend/realtime/crash-stream-routes.ts`, and their tests; registration in `moduleRoutes`.

Out of scope: publishing the events (the worker, branch E); the client-side `watchCrash` (branches F/G).

## Preexisting files touched (additive only)

- `backend/platform/routes.ts` — import `crashStreamRoutes` and append it to `moduleRoutes`.

## Design decisions (DECISIÓN)

- **Cloned, not shared.** `crash-events.ts` and `redis-crash-events.ts` mirror `race-events.ts` and
  `redis-race-events.ts`; the race files are untouched, as required.
- **Two games, one channel.** Races use a single channel because one round runs at a time. Crash has
  two games at once, so the bus call names the game (`publish(game, event)` / `subscribe(game, ...)`)
  and the Redis message is an envelope `{ game, event }` on a single `crash` channel; a subscriber
  only hears its own game. One subscriber connection still serves both games.
- **Event names in English**: `opened`, `takeoff`, `impact`, `settled`, `cashout` (from branch B's
  `crashEventSchema`). Only `impact` carries the revealed seed; the stream route drops, defensively,
  any other event that still carries a `serverSeed`.
- **The stream route self-provisions its bus (otra salida).** The race stream reads
  `services.raceEvents`, wired in `backend/platform/services.ts` and `backend/main.ts` — both **out of
  scope** for this work. Rather than edit them, `createCrashStreamRoutes` takes an optional bus
  (tests inject a memory bus) and otherwise builds a Redis bus lazily from `REDIS_URL` on the first
  stream, closing it on `preClose`. The API and the worker are separate processes that only share
  Redis, so a self-built bus is equivalent to an injected one. Documented here as the reason a
  `services.ts` change was avoided.
- **`:game` is validated before the socket is hijacked**, so an unknown game is a normal 400.

## Tasks

- [x] T1 Event bus: `crash-events.ts` (memory) + `redis-crash-events.ts` (Redis) + tests (fake and
  Redis integration).
- [x] T2 `crash-stream-routes.ts` (SSE per game) + test; register in `moduleRoutes`.

## Acceptance criteria (letter C)

- Works with several backend instances (Redis pub/sub); the client reconnects (SSE + the client's
  reconnect loop, branch F); there are tests.

## Checks

- `npm run lint` — clean.
- `npm run typecheck` — clean.
- `TEST_DATABASE_URL=... TEST_REDIS_URL=... npm test` — green: shared 219, backend 344, frontend 331.
  No new failures vs the known baseline (0). Crash realtime tests: 21.

## Progress

- Branch `feat/crash-realtime` from `feat/crash-api`. Both tasks done.
