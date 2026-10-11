# 2-project-bootstrap

Issue: https://github.com/sebaveaa/casino-simulator/issues/2
Branch: `chore/2-project-bootstrap`
Status: done; squash-merged to `main` as `9d3aeaf` (PR #3)

## Objective

Give the team a runnable skeleton, so module work (auth, wallet, games) can start in parallel.

## Why

The repo holds only the README design and the contribution rules. Teammates cannot start a module until workspaces, tooling, a backend and frontend entry, the local stack and CI exist, and each would otherwise invent their own.

## Scope

- npm workspaces: `shared`, `backend`, `frontend` (README §12 layout).
- Tooling: Node 22, TypeScript strict, Biome (lint and format), Vitest.
- Backend: Fastify, Zod-validated env config (README §13), `GET /health` checking PostgreSQL and Redis, `PROCESS_ROLE` api/worker entry.
- Frontend: Vite + React skeleton.
- Local stack: `docker-compose.yml` with PostgreSQL and Redis, `.env.example`.
- One root `Dockerfile` for both process roles.
- CI: lint, typecheck and tests on every PR.
- `.gitattributes` with LF; `AGENTS.md` lists the commands.

Out of scope: DB schema and migrations, auth, Terraform, deploy.

## Constraints

- npm, not pnpm: pnpm is not installed and the team should not need it.
- Architecture invariants in `AGENTS.md` hold; only placeholder values in `.env.example`.
- Clients: `pg` for PostgreSQL (Kysely comes with wallet), `ioredis` for Redis.

## Tasks

- [x] T1 Record the repo-rules delivery in `odd/tasks/repo-rules.md` (commit 6ca2762, PR #1, remote state).
  Route: inline. One mechanical doc edit.
- [x] T2 Root workspace and tooling: `package.json` workspaces and scripts, `tsconfig.base.json`, `biome.json`, `.gitattributes`, `.gitignore`, `.nvmrc`; `shared` package with one exported schema and a test.
  Route: delegated. Writer trigger: 2+ non-trivial files.
- [x] T3 CI workflow running lint, typecheck and tests; commands listed in `AGENTS.md`.
  Route: delegated, same writer as T2.
- [x] T4 Backend skeleton: env config with Zod, Fastify app with `GET /health`, `PROCESS_ROLE` entry, worker stub, tests.
  Route: delegated. Writer trigger: 2+ non-trivial files.
- [x] T5 Local stack: `docker-compose.yml` (PostgreSQL, Redis) and `.env.example`.
  Route: delegated, same writer as T4.
- [x] T6 Frontend skeleton: Vite + React app with a smoke test.
  Route: delegated. Writer trigger: 2+ non-trivial files.
- [x] T7 Root `Dockerfile` and `.dockerignore`; one image runs either role.
  Route: delegated, same writer as T6.

## Acceptance criteria

From the issue:

- `npm install` at the root installs the `frontend`, `backend` and `shared` workspaces (Node 22).
- `npm run lint`, `npm run typecheck` and `npm test` pass at the root.
- `docker compose up` starts PostgreSQL and Redis using `.env.example` values.
- `GET /health` returns 200 when PostgreSQL and Redis are reachable.
- `PROCESS_ROLE=worker` starts the worker entry instead of the API.
- The backend fails at startup with a clear error on missing or invalid env vars.
- The frontend dev server serves the Vite React app.
- One Docker image builds from the root `Dockerfile`.
- CI runs lint, typecheck and tests on every PR.
- `.gitattributes` enforces LF, and `AGENTS.md` lists the commands.

## Checks

- `npm install`
- `npm run lint`
- `npm run typecheck`
- `npm test`
- From T4: `docker compose up -d`, then `GET /health` returns 200.
- From T7: `docker build .`

## TDD

Mode: off. Source: explicit user choice, 2026-10-11. Runner: Vitest. Ordinary functional checks still run per task.

## Review

RDD is on globally. Per the user, native review runs only for large feature merges; small work units are recorded as "review skipped: user left candidate unreviewed".

## Delivery

Forecast: about 650 authored changed lines (lockfile excluded), over the 400-line budget.
Strategy: `ask-on-risk`. Chain strategy: `feature-branch-chain` (user choice, 2026-10-11).

Tracker: `chore/2-project-bootstrap`, draft PR to `main`, merged only after every child lands. That final merge is the large feature merge that gets native review.

| Slice | Branch | Base | Tasks | Forecast |
|---|---|---|---|---|
| 1 | `chore/2-project-bootstrap-01-tooling` | tracker | T1–T3 | ~200 |
| 2 | `chore/2-project-bootstrap-02-backend` | slice 1 | T4–T5 | ~300 |
| 3 | `chore/2-project-bootstrap-03-frontend` | slice 2 | T6–T7 | ~150 |

## Progress

- Issue #2 created; tracker branch created from `main` at 42fc1fe; plan committed on the tracker as 80d1e76.
- T1 done: structural readback of the `repo-rules.md` diff (status, T4 commit, delivery, applied remote state). Review: skipped, passive doc edit.
- T2 done: `npm install`, `npm ci`, `npm run lint` (8 files clean), `npm run typecheck`, `npm test` (4 passed) all green. `git add --renormalize .` changed nothing; tracked blobs were already LF. Review: skipped, user left candidate unreviewed.
- T3 done: `ci.yml` and AGENTS.md `## Commands` added. YAML parse OK; lint, typecheck and test re-run green (4 passed). Review: skipped, user left candidate unreviewed.
- T4 done: `backend` workspace (Fastify 5, Zod env config, pg and ioredis factories with 1 s ping timeouts, `GET /health`, `PROCESS_ROLE` dispatch, worker stub). `npm install`, `npm ci`, lint, typecheck green; tests 13 passed (4 shared, 9 backend: config, health and CORS, dispatch). Review: skipped, user left candidate unreviewed.
- T5 done: `docker-compose.yml` (postgres:17-alpine, redis:7-alpine, healthchecks, named volume), `.env.example`, AGENTS.md commands. Real stack with `.env` copied from `.env.example`: both containers healthy; `GET /health` 200 `ok`; with redis stopped 503 `redis: false` in 7 ms; after restart 200 again; `PROCESS_ROLE=worker` logged `worker started` and no HTTP listener; unset `DATABASE_URL` exit 1 naming `DATABASE_URL`. Caveat: a host Windows PostgreSQL service already owns port 5432 on this machine, so the Postgres leg was verified on a temporary 5433 mapping (not committed); on a clean machine 5432 applies. Review: skipped, user left candidate unreviewed.

- T5 follow-up: the writer hit a host PostgreSQL on 5432 (`28P01` from the host server); the compose host port is now `${POSTGRES_PORT:-5432}`, documented in `docker-compose.yml` and `AGENTS.md`. Checks: `docker compose config` renders `5432` by default and `5433` with `POSTGRES_PORT=5433`.
- T6 done: `frontend` workspace (Vite 8.3, React 19.3, plugin-react 6.1, jsdom, Testing Library; vite 8 matches vitest 5's peer range and avoids a second vite copy). `npm install`, `npm ci`, lint (28 files), typecheck green; tests 18 passed (4 shared, 13 backend, 1 frontend); `npm run build` built the frontend (dist 220 kB). Dev server serves `<div id="root">` (checked at 127.0.0.1:5180: on this machine localhost:5173 binds IPv6 only and is unreachable). Review: skipped, user left candidate unreviewed.
- T7 done: `backend/build.mjs` (esbuild, externals read from `dependencies`, `@casino/shared` bundled), root `Dockerfile` (two-stage `node:22-alpine`; runtime uses `npm ci --omit=dev --workspace backend`), `.dockerignore`, compose `app` profile, AGENTS.md commands. lint, typecheck, tests (18) and `npm run build` green; `npm ci` ok. `docker build -t casino-cloud .` ok, image 263 MB. With `POSTGRES_PORT=5433`: `docker compose --profile app up -d --build` healthy deps, `GET /health` 200 `{"status":"ok",...}`; same image with `PROCESS_ROLE=worker` logged `worker started (APP_ENV=development)`; `down` kept the volume. Review: skipped, user left candidate unreviewed.
- Root trim (user request): `.gitattributes` reduced to `* text=auto eol=lf` (the `binary` lines were redundant with `text=auto` detection); `CONTRIBUTING.md` moved to `.github/` with its `AGENTS.md` link fixed to `../AGENTS.md`. Checks: `git add --renormalize .` no changes; `git check-attr -a` on a `.png` path reports `text: auto`.

- Delivery: branches pushed; tracker PR #3 (draft, `main`), slice PRs #4 (229 lines), #5 (492 lines, size exception: cohesive backend skeleton), #6 (208 lines). CI `Checks` and `Conventional Commit title` green on #4–#6; #3 has only the title check until children merge. #4 needed a close/reopen because CI did not start on open.

- Merges: #4 → tracker as 81a006e, #5 as 29040e0, #6 as ce2dfb7. After each squash the next child was rebased `--onto` the tracker and retargeted; its tree matched the tested slice tree. Merging #4 with `--delete-branch` closed #5 (its base vanished); restored the branch, reopened #5 and retargeted it. In a chain, retarget the next child before deleting a merged branch.
- Review of the tracker against `main` (the large feature merge): approved and acknowledged, lineage `review-332d389b222dc301`, authority burned. Eleven advisory findings, all non-blocking. The four priority ones (pg pool `'error'` listener, health ping client leak, swallowed Redis errors, compose ports on all interfaces) are fixed in `odd/tasks/platform-hardening.md`. The rest stay open: JWT placeholder accepted in production, `/health` couples liveness and readiness, `PING_TIMEOUT_MS` hides the global 1 s timeouts, `withTimeout` untested, the config "is required" branch unasserted.
- #3 merged to `main` as 9d3aeaf with an admin bypass (sole maintainer cannot approve their own PR); issue #2 closed; tracker branch deleted.

## Next step

None. Follow-up work: `odd/tasks/platform-hardening.md`.
