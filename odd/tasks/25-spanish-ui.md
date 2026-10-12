# 25-spanish-ui

Issue: #25 Frontend: Spanish interface.
Branch: `feat/25-spanish-ui`, from `main` at 5eb8c43.
Status: implemented, PR pending

## Objective

Show the portal in neutral Spanish, and give the lobby motion and polish: game cards that react to hover and press, ambient motion on the landing, and accessibility and small-screen fixes.

## Why

The interface copy is a course deliverable in Spanish. The lobby felt static, and a few rough edges remained: the header was too tall at 360px, the balance showed a bare ellipsis while loading, and focus rings differed between links and buttons.

## Scope

- T1: UI copy in `frontend/src` (pages, shell, tests).
- T2–T4: `frontend/src/styles.css`, `frontend/src/pages/LobbyPage.tsx`, `frontend/src/app/Shell.tsx`, `frontend/src/app/useBalance.tsx`, and their tests.

T2–T4 were added to this PR at the user's request (one PR per feature).

Out of scope: game screens, new dependencies, API changes (`useBalance` keeps its contract).

## Design decisions

- CSS first: motion lives in `styles.css`; the TSX only adds a per-card index (`--i`), a decorative wheel in the pick banner, and a loading attribute on the balance.
- Motion uses `transform` and `opacity`, plus the offset `box-shadow` the identity already animates on `.button`.
- Every animation and transition added here is turned off under `prefers-reduced-motion: reduce`.

## Tasks

- [x] T1 Translate the interface to Spanish (neutral, professional register).
- [x] T2 Game card hover and press: playable cards lift and tilt, the shadow grows, the icon wiggles and the "¡Jugar!" sticker pops; `:active` presses the card down. "¡Pronto!" cards only wiggle their sticker.
  Route: inline in the delegated writer (one stylesheet).
- [x] T3 Ambient motion: staggered entrance of the game cards (`--i` from the list index), a slowly spinning roulette wheel in the pick banner that speeds up while its call to action is hovered or focused, and a gently floating hero sticker.
  Route: delegated writer (stylesheet plus `LobbyPage.tsx` and its test).
- [x] T4 Polish: reduced motion for everything above, one keyboard focus ring for links and buttons, a compact header at ≤ 400px with no horizontal scroll at 320px, and a pulsing placeholder while the balance loads.
  Route: delegated writer (stylesheet, `Shell.tsx`, `LobbyPage.tsx`, `useBalance.tsx`, tests).

Writer trigger: T2–T4 touch 2+ non-trivial files, so one delegated writer does all three.

## Acceptance criteria

- UI copy is in neutral Spanish; code, comments and tests stay in English.
- Playable cards respond to hover, keyboard focus and press; coming-soon cards respond subtly and do not look clickable.
- The landing moves without interaction (card entrance, spinning wheel, floating sticker), and none of it runs with `prefers-reduced-motion: reduce`.
- Links and buttons show the same visible ring on keyboard focus only.
- At 320px wide there is no horizontal scroll, and the header is shorter than before at 360px.
- While the balance loads, the header chip and the pick bubble show a pulsing placeholder; `useBalance` still returns `"…"`, the amount, or `"--"`.
- `npm run lint`, `npm run typecheck`, `npm test` and `npm run build -w frontend` pass.

## Checks

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build -w frontend`

## TDD

Mode: off. Source: explicit user choice for this project, 2026-10-11 (recorded in `8-review-fixes.md`). Runner: Vitest. Ordinary functional checks run per task.

## Review

Per the user, native review runs only for large feature merges. Work-unit commits are recorded as "review skipped: user left candidate unreviewed".

## Delivery

Forecast: about 350 authored changed lines for T2–T4. Strategy: `single-pr` (user preference). One PR from `feat/25-spanish-ui` to `main`, with `Closes #25`.

## Progress

- T1 done: interface translated to Spanish. Commit `b208d66`. Review skipped: user left candidate unreviewed.
- T2 done: `.game-link:is(:hover, :focus-visible)` lifts and tilts the circle with a growing shadow (`--circle-shadow`, tomato on the ink card), wiggles the icon (`icon-wiggle`) and pops the sticker; `:active` presses it down; coming-soon stickers wiggle on hover (`sticker-wiggle`); reduced motion turns all of it off. Checks: lint clean, typecheck clean, test (shared 57, backend 70, frontend 26) pass, `build -w frontend` passes. Commit `988ef56`. Review skipped: user left candidate unreviewed.
- T3 done: game items carry `--i` and enter staggered (`card-in`, 90ms apart); the pick bubble holds a decorative roulette wheel that turns every 14s (`.pick-wheel-turn`) and gets a second, paused spin on its art that runs while the CTA is hovered or focused (`.pick:has(.button:is(:hover, :focus-visible))`), so it speeds up without jumping; the hero sticker floats (`sticker-float`). The card art is wrapped in `.game-art` so the T2 wiggle no longer targets `svg` (Biome `noDescendingSpecificity`). Test added for `--i`. Checks: lint clean, typecheck clean, test (shared 57, backend 70, frontend 27) pass, `build -w frontend` passes. Commit `526612d`. Review skipped: user left candidate unreviewed.
- T4 done: one keyboard ring (`:focus-visible`, 3px ink outline, 4px offset) without the sun halo, which `.button` and the game circles overrode with their own shadows; brand, game link and wallet link get rounded corners so the ring follows them. At `max-width: 25rem` the header packs into three short rows (brand, nav, balance and log in), with smaller padding, gaps and type, and the word "créditos" in the chip visually hidden but still read by screen readers. `BALANCE_LOADING` (`"…"`) is exported from `useBalance.tsx`; the header chip and the pick bubble set `data-loading` while it shows, and CSS turns it into a pulsing placeholder bar (`pulse`). Reduced motion now also stops the card entrance, wheel, floating sticker and pulse. Test added for `data-loading`. Checks: lint clean, typecheck clean, test (shared 57, backend 70, frontend 28) pass, `build -w frontend` passes. Commit `de596b8`. Review skipped: user left candidate unreviewed.
- Not verified visually (no browser in this session): the animations, the 320px and 360px header, and the focus ring were checked structurally only.

## Next step

Check the lobby in a browser (hover, keyboard focus, reduced motion, 320px), then open the PR (`Closes #25`).
