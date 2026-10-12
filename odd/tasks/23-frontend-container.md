# 23-frontend-container

Issue: #23 Infra: containerize the frontend and add it to Docker Compose.
Branch: `feat/23-frontend-container`, from `main` at 05c2067.
Status: implemented, PR pending

## Objective

Run the web portal in a container next to the API, so `docker compose --profile app up --build` starts the whole stack and the portal opens at http://localhost:8080.

## Why

Today only the API runs in a container; the portal needs a local Node setup and `npm run dev -w frontend`. A container gives everyone the same way to open it.

## Scope

- New: `frontend/Dockerfile`, `frontend/nginx.conf`, `frontend/Dockerfile.dockerignore`.
- `docker-compose.yml`: `web` service in the `app` profile; `ALLOWED_ORIGINS` of `app`.
- Docs: `AGENTS.md` (Commands) and the README section on running the project.

Out of scope: the production deploy (#13), a CI job that builds images, connecting the portal to the API (the routes land with #9, #10, #12).

## Design decisions

- The build context is the repository root, because the frontend imports `@casino/shared` and the lockfile lives at the root. `frontend/Dockerfile.dockerignore` (BuildKit's per-Dockerfile ignore file) lets the frontend sources in; the root `.dockerignore`, which keeps them out of the backend image, stays as it is.
- The runtime is `nginxinc/nginx-unprivileged` (non-root, port 8080), like the backend image runs as `node`.
- `VITE_API_URL` is a build argument, empty by default, so the image uses the in-memory mock API until the backend routes exist. Vite inlines it at build time; the browser calls it from the host, so a later value would be `http://localhost:3000`, not a Compose service name.
- Host port `127.0.0.1:8080`, loopback only, like PostgreSQL and Redis. `ALLOWED_ORIGINS` becomes `http://localhost:5173,http://localhost:8080`.

## Tasks

- [x] T1 Frontend image: Dockerfile, nginx config with the SPA fallback and cache headers, per-Dockerfile ignore file; the image builds and serves `/` and `/wallet`.
  Route: delegated. Writer trigger: T1–T2 touch 2+ non-trivial files (one writer).
- [x] T2 Compose `web` service, `ALLOWED_ORIGINS`, and docs; `docker compose --profile app up --build` serves the portal; `docker compose up -d` still starts only PostgreSQL and Redis.
  Route: delegated, same writer.

## Acceptance criteria

- The image builds from the root context and answers 200 with the app's `index.html` at `/` and `/wallet`.
- Hashed assets carry a long cache lifetime; `index.html` is not cached.
- `docker compose --profile app up --build` starts PostgreSQL, Redis, the API and the web; `docker compose up -d` starts only PostgreSQL and Redis.
- The backend image build is unchanged.
- `AGENTS.md` and the README say where to open the portal.

## Checks

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `docker build -f frontend/Dockerfile -t casino-cloud-web .`
- `docker build -t casino-cloud .` (backend image still builds)
- `docker compose --profile app config` and a container smoke test from inside the container (loopback from the host shell is blocked in this environment)

## TDD

Mode: off. Source: explicit user choice for this project, 2026-10-11. Runner: Vitest. Ordinary functional checks run per task.

## Review

Per the user, native review runs only for large feature merges. This change is small; work units are recorded as "review skipped: user left candidate unreviewed".

## Delivery

Forecast: about 120 authored changed lines. Strategy: `single-pr` (user preference). One PR from `feat/23-frontend-container` to `main`, with `Closes #23`.

## Progress

- Issue #23 created; branch `feat/23-frontend-container` created from 05c2067.
- T1 done: image `nginxinc/nginx-unprivileged:1.28.0-alpine` builds from the root context; in-container smoke test: `/`, `/wallet`, `/index.html` return 200 with the app shell and `no-cache`, hashed `/assets/*.js` returns `public, max-age=31536000, immutable`; backend image still builds; lint, typecheck, test (26) pass. Review: skipped, user left candidate unreviewed.
- T2 done: `docker compose config --services` lists postgres, redis; with `--profile app` also web, app. `up -d --build` ran all four services (postgres, redis healthy; host port 5432 was taken, so `POSTGRES_PORT=5433` was set in the shell only); web served `index.html` from inside the container; stack removed with `down` (volumes kept). `npm run lint` passes. README had no run section, so a short paragraph was added after the §12 tree. Review: skipped, user left candidate unreviewed.

## Next step

Open the PR (`Closes #23`).
