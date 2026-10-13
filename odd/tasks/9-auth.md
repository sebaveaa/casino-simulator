# 9-auth

Issue: https://github.com/sebaveaa/casino-simulator/issues/9
Branch: feat/9-auth (feature base, stacked on `feat/10-wallet-03-page` because #10 is not on `main` yet); slices feat/9-auth-0N-*
Status: in progress

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
- Registration inserts the user and creates the player wallet in one PostgreSQL transaction, so a failed wallet never leaves a user without one. A duplicate email or username answers 409.
- Login answers the same 401 for an unknown user and a wrong password (no user enumeration).
- Bodies validated with the Zod schemas in `shared/src/api/auth.ts`.
- Frontend keeps the token in `localStorage` (wrapped in try/catch) and sends `Authorization: Bearer`; a 401 clears the session.

## Tasks

- [x] T1 Backend: `JwtTokenService`, password hasher, `POST /auth/register` and `POST /auth/login` in `moduleRoutes`, wiring in `main.ts`, `.env.example`/config for `JWT_SECRET`, tests (register, duplicate, login, wrong password, invalid token, expired token, role check). Route: delegated (writer trigger: 3+ non-trivial files).
- [ ] T2 Frontend: login and register screens calling the API, session provider persisted across reloads, bearer token in the HTTP client, mock API support, route guard, Spanish UI copy, component tests. Route: delegated (writer trigger: 3+ non-trivial files).

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
- T1 done on `feat/9-auth-01-backend` (route: delegated writer). ~460 authored lines (tests included, lockfile excluded). Checks: format and lint clean; typecheck clean; `npm test` 97 passed, 17 skipped (no database); with `TEST_DATABASE_URL` against compose Postgres (port 5433) 114 passed; `npm run build -w backend` ok. Register returns 201 and logs the user in (`AuthResponse`); login returns 200.

## Next step

T2 on `feat/9-auth-02-screens`.
