# crash-aviator-ui

Issue: TBD — letter **G** of `PLAN-CRASH.md` §7 (Claudia creates the GitHub issue).
Branch: `feat/crash-aviator-ui`, from `feat/crash-dino-ui`.
Status: implemented, PR pending (Claudia commits and opens it).

## Objective

Despegue: the second animation over the same Crash engine — a new scene, the Despegue copy, a route
and the hub card. Reuses the Dino Crash page unchanged (PLAN-CRASH §6.1, letter G).

## Scope

In scope: `frontend/src/pages/crash/PlaneStage.tsx`, `frontend/src/pages/AviatorPage.tsx`, the plane
styles in `crash.css` (my file), the route, the hub card, tests.

Out of scope: the engine, API, realtime, worker and the shared page (done in B–F).

## Preexisting files touched (additive, except the UI points the plan calls for)

- `frontend/src/app/routes.tsx` — the `/games/mini/aviator` route.
- `frontend/src/pages/MiniGamesPage.tsx` — the Despegue card becomes playable (its `path`).
- `frontend/src/pages/MiniGamesPage.test.tsx` — same DECISIÓN as branch F: the authorised card change
  makes all three games playable, so the hub assertion is updated (no card is "Muy pronto").

## Design decisions (DECISIÓN)

- **Only a scene and a config.** `AviatorPage` renders `CrashPage` with `{ game: "aviator", title:
  "Despegue", Stage: PlaneStage, impactText: "¡Se fue volando! x", capText: "¡Llegó al cielo! 20,00x" }`.
  The shared page from branch F is untouched.
- **"Aviator" never reaches the interface.** It is only the internal id and the URL segment; the title,
  copy and scene all say "Despegue". A test asserts the rendered page contains no "aviator" text.
- **Scene colours** per the plan: ink sky, tomato climb curve, sun plane; `prefers-reduced-motion`
  freezes the plane mid-climb instead of animating.

## Tasks

- [x] T1 `PlaneStage` + its styles in `crash.css`.
- [x] T2 `AviatorPage`, the route and the hub card; tests.

## Acceptance criteria (letter G)

- Reuses the Dino Crash components; only the scene and the copy change.

## Checks

- `npm run lint` — clean.
- `npm run typecheck` — clean.
- `TEST_DATABASE_URL=... TEST_REDIS_URL=... npm test` — green: shared 219, backend 352, frontend 352.
  No new failures vs the known baseline (0). New frontend tests: 2 (Despegue page, no "Aviator" copy).

## Notes

- One shared-DB integration test (`chicken-road game.integration — history`) flaked once during a full
  run (parallel vitest workers on the one database); it passed alone and the full backend suite passed
  on re-run. The Crash integration tests roll back their transactions and the worker test uses an
  isolated schema, so they leave no shared-DB residue. Treated as the known preexisting flakiness.

## Progress

- Branch `feat/crash-aviator-ui` from `feat/crash-dino-ui`. Both tasks done.

## Corrections (post-PR, user feedback)

- **Plane visual (Fix 2b):** `PlaneStage` redrawn as an original side-view passenger jet (long
  fuselage, nose, swept wing, tail fin with stabiliser, row of windows, cockpit) that tilts as it
  climbs the curve, instead of the earlier triangle. Only existing tokens; reduced motion freezes it
  mid-climb. Render test added.
- The cash-out UX fix and the dino redraw (branch F) and the 8 s window (branch D) reach this branch
  by `git merge` of the parent (no rebase); `crash.css` merged cleanly (dino legs + plane both kept in
  the reduced-motion block).
- **DECISIÓN:** the plane was redrawn **after** merging F into G (not before, as the plan's branch
  order suggests), so `crash.css` had no three-way conflict between the dino and plane edits.
