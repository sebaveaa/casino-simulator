# crash-dino-ui

Issue: TBD — letter **F** of `PLAN-CRASH.md` §7 (Claudia creates the GitHub issue).
Branch: `feat/crash-dino-ui`, from `feat/crash-worker`.
Status: implemented, PR pending (Claudia commits and opens it).

## Objective

The playable Dino Crash screen: the API client (http + mock), the shared Crash components, and the
game-parameterised page with its five round states and recovery (PLAN-CRASH §6).

## Why

With the engine, API, realtime and worker done, the player needs a screen: bet, watch the multiplier
rise, and cash out before the impact. Despegue (branch G) is one more scene over the same page.

## Scope

In scope: `frontend/src/api/{client,http,mock}.ts`; `frontend/src/pages/crash/*`;
`frontend/src/pages/DinoCrashPage.tsx`; the route and the hub card.

Out of scope: the Despegue scene and route (branch G); the shared verifier (#15).

## Preexisting files touched (additive, except the two UI points the plan calls for)

- `frontend/src/api/client.ts` — `ApiClient` gains `getCurrentCrash`, `placeCrashBet`, `cashOutCrash`,
  `watchCrash`, `listCrashHistory`.
- `frontend/src/api/http.ts` — those methods + a `watchCrash` stream (clone of `watchRaces`, with the
  `:game` path and `crashEventSchema`).
- `frontend/src/api/mock.ts` — a per-game round state machine (timers + the real `shared` rules) so
  the screen works with no backend, including cash-out timing.
- `frontend/src/app/routes.tsx` — the `/games/mini/dino-crash` route.
- `frontend/src/pages/MiniGamesPage.tsx` — the Dino Crash card becomes playable (its `path`).
- `frontend/src/pages/MiniGamesPage.test.tsx` — **DECISIÓN:** not in the allowed list, but the
  authorised card change breaks its "both Crash games coming soon" assertion. Updating that one
  assertion (Dino Crash now playable, Despegue still "Muy pronto") is the direct, unavoidable
  consequence of the authorised change, so it is adjusted rather than left failing.

## Design decisions (DECISIÓN)

- **Game-parameterised page.** `CrashPage({ config })` holds the whole flow; `DinoCrashPage` passes the
  Dino config (title, scene, impact/cap copy). Branch G only adds an Aviator config and a `PlaneStage`.
- **New CSS file** `pages/crash/crash.css`, imported by the page, using only the existing tokens
  (`styles.css` is out of scope, so no class is added there). A `prefers-reduced-motion` query turns
  the run animation off.
- **Animation.** `useLiveMultiplier` rises with `multiplierAtHundredths(now - takeoff)` via
  `requestAnimationFrame`, freezing at the real impact point once it is known; with reduced motion it
  steps every 250 ms. The clock offset comes from the snapshot's `now`, so the phone clock does not
  matter. The server never ticks the multiplier.
- **The screen decides nothing.** The cash-out button only sends the request; the amount paid is the
  server's answer. State follows the snapshot + the SSE events through a reducer cloned from `raceState`.
- Stakes in whole credits (10–500); amounts shown with `formatCredits`; multipliers as `2,45x`.

## Tasks

- [x] T1 API client: `client.ts`, `http.ts` (`watchCrash`), `mock.ts` (round simulation + cash-out).
- [x] T2 Components: `crashState`, `useLiveMultiplier`, `Multiplier`, `BetPanel`, `Countdown`,
  `CrashHistory`, `CrashFairness`, `DinoStage`, `format`, `crash.css`.
- [x] T3 `CrashPage` + `DinoCrashPage`, the route and the hub card; tests.

## Acceptance criteria (letter F)

- All the design states; the round recovers on reload (snapshot on each connect); the balance updates;
  works with the mock and the real backend; respects `prefers-reduced-motion`; there are tests.

## Checks

- `npm run lint` — clean.
- `npm run typecheck` — clean.
- `TEST_DATABASE_URL=... TEST_REDIS_URL=... npm test` — green: shared 219, backend 352, frontend 349.
  No new failures vs the known baseline (0). New frontend tests: 18 (format, reducer, page states).

## Progress

- Branch `feat/crash-dino-ui` from `feat/crash-worker`. All tasks done.

## Corrections (post-PR, user feedback)

- **Cash-out UX (Fix 1):** the cash-out was not broken, but it was invisible unless the player bet
  during the window, with no instructions and no keyboard. Added: a permanent "how to play" line; a
  keyboard shortcut (Enter / Space cash out, only while flying with a pending bet, never from a form
  field, ignoring `event.repeat`, and blocked while a request is in flight — same request as the
  button, server still decides the amount); per-state panel messages (betting countdown, "ya despegó,
  espera la próxima" when flying without a bet, "apuesta lista · despega en {s} s", the big "Retirar"
  button with "o pulsa Enter / Espacio"); an `aria-live` status region and a visible focus ring.
  - **DECISIÓN:** for "flying without a bet" there is no precise countdown to the next round, because
    the server does not expose the next open time; the panel shows the message without a countdown.
- **Dino visual (Fix 2a):** `DinoStage` redrawn as an original bipedal-dinosaur silhouette (big head
  with an open jaw, eye, long raised tail, strong hind legs that run, short arm). Original art, not the
  browser dinosaur. Reduced motion stops the legs. Render test added.
