# 21-arcade-identity

Issue: #21 Frontend: Arcade visual identity and lobby layout.
Branch: `feat/21-arcade-identity`, from `main` at 0bea633.
Status: implemented, pending PR

## Objective

Move the chosen visual identity into the frontend: Arcade tokens and fonts, a restyled shell, and the Candy Box lobby layout. The module screens (#9, #10, #12) then start from the final style.

## Why

The shell and lobby from #8 use a placeholder casino-felt theme. A prototype round settled the direction: keep the Arcade identity (D) and use the Candy Box layout (G). The reference board is "Final · Arcade identity with Candy Box layout" in the design canvas (https://claude.ai/artifact/GHtxGa6Qkqs5NtLpMrwSwV). The canvas is the prototype's primary source; it stays out of `main`.

## Scope

- `frontend/src/styles.css`, `frontend/src/main.tsx` (font imports), `frontend/package.json` and `package-lock.json` (font packages).
- `frontend/src/app/Shell.tsx` and the lobby in `frontend/src/pages/LobbyPage.tsx`, plus small presentational components they need.
- `frontend/src/App.test.tsx` and new tests next to the components.

Out of scope: the game screens, a "How to bet" page, the auth, wallet and roulette features themselves.

## Design decisions

- Tokens: lilac `#F1ECFF` ground, ink `#141414` text, 3px outlines and hard offset shadows, tomato `#FF5A36` primary, sun `#FFC933` highlights and credits, chalk `#FFFFFF` cards, muted `#4A4458` secondary text. Ink on tomato measures about 5.9:1 (AA).
- Fonts self-hosted through Fontsource packages, bundled by Vite. The cloud build serves them with the rest of the static assets, with no third-party font request.
- The lobby's "Today's pick" banner keeps the Roulette call to action and the balance bubble. The design's "How to bet" button is left out until a page exists for it.
- Coming-soon games render as plain items, not links, so keyboard users only reach playable games.

## Tasks

- [x] T1 Tokens, fonts and shared classes (`.button`, `.badge`, links, focus ring, reduced motion); every existing page still renders.
  Route: delegated. Writer trigger: T1–T3 touch 2+ non-trivial files (one writer).
- [x] T2 Shell: die logo and wordmark, Lobby/Wallet nav with the current page marked, coin balance chip, Log in; centered footer; tests.
  Route: delegated, same writer.
- [x] T3 Lobby: centered hero, round game buttons with Play!/Soon! stickers, "Today's pick" banner with the balance; responsive to 360px; tests.
  Route: delegated, same writer.

## Acceptance criteria

- The tokens and fonts above are defined once and used by the shared classes.
- Login, register, wallet, roulette and not-found pages still render with the new look.
- The header shows the logo, the nav with `aria-current` on the active page, the balance in Space Mono and the Log in action; the footer keeps the fictitious-credits notice.
- The lobby shows the hero, one round button per game (links only for live games) and the banner with the Roulette link and the balance.
- No horizontal scroll at 360px; visible focus on every control; AA contrast; tilts and hover motion respect `prefers-reduced-motion`.
- `npm run lint`, `npm run typecheck` and `npm test` pass.

## Checks

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build -w frontend`

## TDD

Mode: off. Source: explicit user choice for this project, 2026-10-11 (recorded in `8-review-fixes.md`). Runner: Vitest. Ordinary functional checks run per task.

## Review

Per the user, native review runs only for large feature merges. Work-unit commits are recorded as "review skipped: user left candidate unreviewed"; the merge of the whole feature is the large candidate.

## Delivery

Forecast: about 900 authored changed lines. Strategy: `single-pr`, by explicit user choice (2026-10-11), overriding the 400-line split. One PR from `feat/21-arcade-identity` to `main`, with `Closes #21`.

## Progress

- Issue #21 created; branch `feat/21-arcade-identity` created from 0bea633.
- T1 done: Arcade tokens, Fontsource fonts (`@fontsource-variable/bricolage-grotesque` 5.3.0, `@fontsource/space-mono` 5.3.0), shared classes, focus ring, reduced motion. Checks: lint, typecheck, test (15 passed), `build -w frontend` all pass. Commit `3c9d792`. Review skipped: user left candidate unreviewed.
- T2 done: shell header and footer restyled, `useBalance` hook extracted, `Shell.test.tsx` added. Checks: lint, typecheck, test (18 passed), `build -w frontend` all pass. Commit `06bd0a6`. Review skipped: user left candidate unreviewed.
- T3 done: lobby hero, round game buttons, Today's pick banner; `LobbyPage.test.tsx` added, App test updated. Checks: lint, typecheck, test (22 frontend tests passed), `build -w frontend` all pass. Commit hash reported by the writer. Review skipped: user left candidate unreviewed.

## Next step

Open the single PR (see Delivery).
