# 8-review-fixes

Issue: #8 (advisory findings from the core contract reviews, recorded in `odd/tasks/8-core-contracts.md`).
Branch: `fix/8-review-fixes`, stacked on `feat/8-core-04-frontend` (PR #19).
Status: in progress

## Objective

Fix five advisory findings from the #8 reviews before the module tickets (#9, #10, #12) build on these contracts.

## Why

- Amount schemas convert any all-digit string with `BigInt`, whatever its length: a huge input costs CPU to reject.
- `passwordSchema` caps characters, but bcrypt truncates at 72 bytes: two passwords that share their first 72 UTF-8 bytes hash the same.
- `main.ts` logs pg and Redis errors through `app`, which is in its temporal dead zone until `buildApp` resolves: an early Redis error crashes the process with a `ReferenceError` instead of logging.
- The auth guard turns every `verify` failure into 401 without a log: a database outage logs users out and leaves no trace.
- The error handler answers every Fastify 4xx as 400: 413 and 415 lose their meaning.

## Scope

- `shared/src/money.ts`, `shared/src/api/auth.ts` and their tests.
- `backend/main.ts`, `backend/platform/app.ts` (logger), `backend/auth/token-service.ts`, `backend/auth/guard.ts`, `backend/platform/errors.ts` and their tests.
- `backend/package.json` if the logger needs `pino` as a declared dependency.

Out of scope: the other 26 advisory findings; the worker's logging; decimal input for credits.

## Design decisions

- Amounts: a length cap of 20 characters (19 digits of `MAX_MONEY` plus a sign), enforced before any `BigInt` call. Zod 4 keeps running checks after a failed one, so the guard lives inside the bound refinement as well as on the schema.
- Passwords: register and login both limit the UTF-8 byte length to 72 (bcrypt's limit), so a longer login input cannot match a stored 72-byte password by truncation.
- Logger: `main.ts` creates the API's pino logger first, hands it to the pg and Redis error callbacks, and passes the same instance to `buildApp`.
- Auth guard: `TokenService.verify` throws `InvalidTokenError` for a bad, forged or expired token. Only that error becomes 401; any other error propagates, so the error handler logs it and answers 500 (`NotImplementedError` still answers 501).
- Error handler: a Fastify 4xx keeps its status, with code `invalid_request` and a fixed message per status (413, 415, otherwise "Malformed request"). The shared error codes stay unchanged.

## Tasks

- [x] T1 Shared: amount length cap; password byte limit for register and login; tests.
  Route: delegated. Writer trigger: 2+ non-trivial files across T1–T4 (one writer).
- [x] T2 Backend: create the logger before the pg and Redis clients; tests.
  Route: delegated, same writer.
- [x] T3 Backend: `InvalidTokenError`; the guard answers 401 only for it; tests.
  Route: delegated, same writer.
- [x] T4 Backend: keep the status of Fastify 4xx errors; tests.
  Route: delegated, same writer.

## Acceptance criteria

- A 1,000,000-digit amount is rejected without calling `BigInt` on it; valid amounts up to `MAX_MONEY` still pass.
- A password over 72 UTF-8 bytes is rejected even when it has 72 characters or fewer, at register and at login.
- A pg or Redis error raised before `buildApp` resolves is logged, and the process keeps running.
- An `InvalidTokenError` from `verify` answers 401; any other error answers 500 and is logged.
- A body over the limit answers 413 and a wrong content type answers 415, both with the shared error body.
- `npm run lint`, `npm run typecheck` and `npm test` pass.

## Checks

- `npm run lint`
- `npm run typecheck`
- `npm test`

## TDD

Mode: off. Source: explicit user choice for this project, 2026-10-11. Runner: Vitest. Ordinary functional checks run per task.

## Review

Per the user, native review runs only for large feature merges. This fix is small; work units are recorded as "review skipped: user left candidate unreviewed".

## Delivery

Forecast: about 250 authored changed lines, under the 400-line budget. Strategy: `single-pr`, stacked on PR #19 (base `feat/8-core-04-frontend`).

## Progress

- Branch `fix/8-review-fixes` created from e0f4be3.
- T1 done: lint clean, typecheck clean, npm test passed (shared 57, backend 65, frontend 15). The 1,000,000-digit amount is rejected with `BigInt` never called; the bounds and 20-digit cases behave as specified; passwords of 72 bytes pass and 73 or 74 bytes fail at register and login. Review: skipped, user left candidate unreviewed.
- T2 done: lint clean, typecheck clean, npm test passed (shared 57, backend 66, frontend 15). Real run of `node backend/dist/main.js` with Redis on a closed port (6390) for 6 seconds: the server listened, one `"msg":"redis error"` line (ECONNREFUSED 127.0.0.1:6390) was logged through the shared pino logger, no `ReferenceError`, and the process stayed up until the timeout (exit 124). Added `pino` ^10.4.0 to the backend (the version Fastify resolves) and `lib: DOM` to the shared tsconfig for `TextEncoder` (T1 typecheck fix, amended into the T1 commit). Review: skipped, user left candidate unreviewed.
- T3 done: lint clean, typecheck clean, npm test passed (shared 57, backend 67, frontend 15). `InvalidTokenError` answers 401 with the shared error body; a generic `Error` from `verify` answers 500 `internal` and the handler logs "unhandled error" (asserted through an in-memory pino stream); `NotImplementedError` still answers 501. Review: skipped, user left candidate unreviewed.
- T4 done: lint clean, typecheck clean, npm test passed (shared 57, backend 70, frontend 15). A body over the route limit answers 413 "Request body too large", an unknown content type answers 415 "Unsupported content type", malformed JSON answers 400 "Malformed request"; each body validates against `errorResponseSchema`. Review: skipped, user left candidate unreviewed.

## Next step

All tasks done; open the pull request.
