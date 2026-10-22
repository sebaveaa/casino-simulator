# 43-mini-games-hub

Issue: https://github.com/sebaveaa/casino-simulator/issues/43
Branch: `feat/43-mini-games-hub`, from `main` at 7968cfb.
Status: implemented, PR pending (Juan commits and opens it)

## Objective

Replace the Slots card in the lobby with "Minijuegos" and add the `/games/mini` screen with three cards (Cruza la Calle, Dino Crash, Despegue), none playable yet. Frontend only.

## Why

The team chose mini games over slots (#14). The hub is the entry point for Cruza la Calle (#46) and the Crash games that follow; it ships first so the visual direction lands before any game logic.

## Scope

In scope: the lobby card and its icon, the mini games page and route, styles, tests, and the games table in README §1.

Out of scope: game rules, API and backend (`shared/`, `backend/` untouched); making Cruza la Calle playable (#46); the other README mentions of slots (§2.1 diagram, §4.2, §5.1, §6, §11, §12, §14), left for the documentation issue of the mini games plan.

Design source: `DISENO-MINIJUEGOS.md` §1 and §2 (approved 2026-10-21, kept outside the repo), with `PLAN-CHICKEN-ROAD.md` phase 2.

## Design decisions

- **`GameId` stays as is.** `GameId` in `shared/src/games/game.ts` mirrors the games the database accepts (`bets_game_check`, `BetGame`). "Minijuegos" is a menu, not a game that records bets, and the real ids (`chicken-road`, `dino-crash`, `aviator`) arrive with the backend migration. The smallest change that keeps the typing correct is frontend only: `GameIcons.tsx` exports `GameArtId = Exclude<GameId, "slots"> | "mini-games"`, used by `GameArt` and the lobby `games` list.
- The slots icon, its test and its reel CSS are removed: nothing renders them anymore.
- Every card on `/games/mini` is "Muy pronto" in this PR. The card already renders a `¡Jugar!` link when its entry has a `path`, so #46 only adds the path.
- The design gives no SVG for the Dino Crash and Despegue panels, only their colors; they are drawn in the same stroke style (3px ink, round joins) and stay static.
- The card grid uses `minmax(min(280px, 100%), 1fr)`: same as the design's `minmax(280px, 1fr)` on wide screens, without overflow on very narrow ones.
- Only existing tokens from `styles.css`, plus the road grey `#3a3a3a` the design allows.

## Tasks

- [x] T1 Lobby: "Minijuegos" card (chalk, `/games/mini`, "Nuevo" tag) and the controller-and-bolt icon with idle blink and hover shake; slots art removed; lobby, App and icon tests updated.
  Route: inline.
- [x] T2 `MiniGamesPage` at `/games/mini` inside `RequireSession`: back link, hero header, three cards with illustrated panels; styles with reduced motion and 360px; page tests.
  Route: inline.
- [x] T3 README §1 games table: Tragamonedas becomes Minijuegos.
  Route: inline.

## Acceptance criteria

From the issue:

- The lobby shows "Minijuegos" with a new icon.
- `/games/mini` shows three cards in the Arcade style.
- It requires a session.
- It works at 360px and respects `prefers-reduced-motion`.
- There are tests.
- The README is updated.

## Checks

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build -w frontend`

## TDD

Mode: off. Source: carried from the user's choice on earlier tickets (no project-level setting). Runner: Vitest.

## Delivery

Forecast: about 400 authored changed lines. Strategy: `single-pr`. Juan makes the commits, pushes and opens the PR (`Closes #43`); the agent only edits files and runs checks.

## Progress

- Planned. Branch `feat/43-mini-games-hub` created by Juan from `main` (7968cfb).
- T1 done: lobby entry `mini-games` (chalk, `/games/mini`, `isNew`), "Nuevo" tag (`.game-new`, `new-pulse`), controller-and-bolt icon (`.art-bolt`: `bolt-blink` idle, `bolt-shake` on hover or focus), `GameArtId` type; slots art, its test and the reel CSS removed. Tests: lobby links (roulette and `/games/mini`), two "¡Pronto!", the "Nuevo" tag, the icon's bolt and `aria-hidden`; App test count updated. Checks: lint, typecheck, the three test files pass.
- T2 done: `MiniGamesPage` and `mini-games/MiniGameArt.tsx` (road panel with `Chicken` and `Car`, exported for #46; Dino Crash and Despegue scenes), route inside `RequireSession`, `.mini-*` styles, reduced motion for the float, the car and the lift. `MiniGameCard` renders a `¡Jugar!` link when an entry has a `path`. Tests: header and back link, three cards with kind, description and top multiplier, three "Muy pronto" and no links, decorative panels, redirect to `/login` without a session, a playable card. Lint fixes: `aria-hidden` on the scene SVGs; `> *` instead of `svg` in the road selectors (Biome `noDescendingSpecificity`).
- T3 done: README §1 games table, Tragamonedas row replaced by Minijuegos.
- Final checks: `npm run lint` clean (163 files); `npm run typecheck` clean; `npm test` green: shared 130, backend 109 passed and 43 skipped (no database), frontend 156; `npm run build -w frontend` passes. One full run had two backend 401 route tests time out at 5 s under load (`rng/routes.test.ts`, `games/roulette/routes.test.ts`, untouched here); they pass alone and on the next full run.
- Not verified visually (no browser in this session): the 360px layout, the panels and the animations were checked structurally only. Visual check pending with Juan.

## Next step

Juan reviews `/` and `/games/mini` in the browser (360px and reduced motion), commits and opens the PR (`Closes #43`).
