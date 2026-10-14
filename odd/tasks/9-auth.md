# 9-auth

Issue: https://github.com/sebaveaa/casino-simulator/issues/9
Branch: feat/9-auth (feature base, from `main` at 50b879e after #10 merged as #30); slices feat/9-auth-0N-*
Status: T1 and T2 done, PRs not opened

## Objective

Players register and log in; the backend authenticates every request with a JWT and checks roles (README §2.3, §8).

## Why

Auth is the next link of the MVP chain (#10 → #9 → #11 → one game). Until it lands, every guarded route answers 501 because `stubTokenService` throws `NotImplementedError`.

## Scope

In scope: a JWT `TokenService` signed with `JWT_SECRET`, password hashing, `POST /auth/register` (user plus player wallet through `WalletService.createPlayerWallet`), `POST /auth/login`, wiring in `main.ts`, the login and register screens, session persistence in the frontend, and the HTTP client sending the bearer token.

Out of scope: refresh tokens, logout on the server, password reset, rate limiting (README §8, later ticket), admin screens.

## Design decisions

- JWT with `jose` (pure JS, HS256, `sub` = user id, `role` claim, expiry). `verify` maps every `jose` failure to `InvalidTokenError`, so the existing guard answers 401.
- Passwords hashed with `bcryptjs` (pure JS, no native build in the Alpine image). The issue allows argon2 or bcrypt.
- Registration inserts the user and creates the player wallet in one PostgreSQL transaction, so a failed wallet never leaves a user without one. A duplicate email answers 409.
- Login answers the same 401 for an unknown user and a wrong password (no user enumeration).
- Bodies validated with the Zod schemas in `shared/src/api/auth.ts`.
- Frontend keeps the token in `localStorage` (wrapped in try/catch) and sends `Authorization: Bearer`; a 401 clears the session.

## Tasks

- [x] T1 Backend: `JwtTokenService`, password hasher, `POST /auth/register` and `POST /auth/login` in `moduleRoutes`, wiring in `main.ts`, `.env.example`/config for `JWT_SECRET`, tests (register, duplicate, login, wrong password, invalid token, expired token, role check). Route: delegated (writer trigger: 3+ non-trivial files).
- [x] T2 Frontend: login and register screens calling the API, session provider persisted across reloads, bearer token in the HTTP client, mock API support, route guard, Spanish UI copy, component tests. Route: delegated (writer trigger: 3+ non-trivial files).

## Acceptance criteria

Issue #9 criteria, all six.

## Checks

`npm run lint`, `npm run typecheck`, `npm test` (with `TEST_DATABASE_URL` set against the local compose Postgres after `npm run migrate`), `npm run build -w backend`, `npm run build -w frontend`.

## TDD

Mode: off. Source: carried from the user's choice on #25 and #10 (no project-level setting). Runner: Vitest.

## Review

Native review only for large feature merges (user preference); small work units are left unreviewed.

## Delivery

Forecast: ~800 authored lines (T1 ~450, T2 ~350).
Strategy: ask-on-risk. Chain strategy: feature-branch-chain (same as #10). Slice PRs target `feat/9-auth`; one final PR merges `feat/9-auth` into `main` after #10 and closes #9.

| Slice | Branch | Base | Tasks | Forecast |
|-------|--------|------|-------|----------|
| 1 | feat/9-auth-01-backend | feat/9-auth | T1 | ~450 |
| 2 | feat/9-auth-02-screens | slice 1 | T2 | ~350 |

## Progress

- Planned. Branch `feat/9-auth` created from `feat/10-wallet-03-page` (13e2195).
- T1 done on `feat/9-auth-01-backend` (commit `9ec6fb6`, route: delegated writer). ~460 authored lines (tests included, lockfile excluded). Checks: format and lint clean; typecheck clean; `npm test` 97 passed, 17 skipped (no database); with `TEST_DATABASE_URL` against compose Postgres (port 5433) 114 passed; `npm run build -w backend` ok. Register returns 201 and logs the user in (`AuthResponse`); login returns 200.
- T2 done on `feat/9-auth-02-screens` (route: delegated writer). ~1120 authored lines changed (additions plus deletions, tests included, task file excluded roughly 1050), well over the ~350 forecast because the session store, guard, mock auth and their tests are covered together. Checks: format and lint clean; typecheck clean; `npm test` shared+backend 97 passed, 17 skipped (no database), frontend 78 passed (parent spot check: frontend 78 passed); `npm run build -w frontend` ok. Commit `c5ea630`. Mock API keeps users in memory (409 on duplicate, 401 on bad credentials) and issues unsigned JWT-shaped tokens; the lobby stays public and shows `--` for the balance while logged out.
- Native review: preflight after T1 (base `main`, so it re-included #10; high risk, 27 files, 2095 lines): declined by the user for that candidate. The decline invocation then refused with `stale_target_identity` because T2 had been committed meanwhile; nothing was recorded. No review of the full #9 feature yet.
- Rebased onto `main` (50b879e) after #10 merged; its tree matched the old base 13e2195, so no conflicts. Commits now 70d0113 (T1), b07aca6 (T2).
- Final native review of the whole feature (`50b879e..b00f308`, 37 files, 1671 lines): lineage `review-e65047b53965d6b5`, high risk, 4 lenses, approved and acknowledged (authority burned), no correction.

## Advisory notes (open)

- R1 WARNING: register and login have no rate limiting or lockout (deferred to the README §8 rate-limit ticket) (`backend/auth/routes.ts`).
- R3 SUGGESTION: the cached placeholder hash promise for unknown emails stays rejected after one failure, turning the uniform 401 into 500 (`backend/auth/password-hasher.ts`).
- R1 SUGGESTION: token in `localStorage` is readable by any XSS (documented decision).
- R2 SUGGESTION: `useSessionStore` error names `useSession`; `--` balance literal duplicated in `useBalance.tsx`; placeholder password literal unexplained.

- Token lifetime is fixed at 1 h (no env setting); bcrypt cost fixed at 10.
- Auth route tests run only with `TEST_DATABASE_URL`.
- Logged-out lobby shows `--` for the balance; the mock wallet is one shared balance; a token that expires mid-session is detected only on the next 401.

## Next step

Open slice PRs into `feat/9-auth`, then the final PR to `main` (Closes #9).
