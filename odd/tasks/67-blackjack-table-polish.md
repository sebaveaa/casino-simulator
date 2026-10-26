# 67-blackjack-table-polish

Issue: https://github.com/sebaveaa/casino-simulator/issues/67
Branch: `feat/67-blackjack-table-polish`, from `feat/65-blackjack-split`.
Status: in progress.

## Objective

Polish the Blackjack table with what came out of playtesting #64 and #65: casino chips for the bet, sounds, card-back designs, the shuffle animation, and a panel that fits wide screens. Frontend only: the server still decides every card, charge and payout (README §2.2, §4.2).

## Why

Playtest feedback from Juan Sebastián. It used to ride on #65; it moved here so the split PR stays reviewable on its own.

## Scope

In scope: `frontend/src/pages/blackjack/`, `BlackjackPage`, the Blackjack part of `frontend/src/styles.css`, and their tests.

Out of scope: the continuous shoe and its progress bar (#66); a shop to buy the priced card backs (a purchase must move credits through the wallet, README §2.3).

## Tasks

- [x] T1 Chips that build the bet, Repetir apuesta in the result pop-up, and the table's sounds (recorded card, chip, result by the net); the wager buttons in a quiet tray.
- [x] T2 Chips piled as placed and shown next to each hand on the felt, the waiting felt, the shuffle animation with its test button, and the Mazos card backs.
- [ ] T3 The two-column panel on wide screens, shorter loss pills in the history, chips cleared when the balance no longer covers them, and the empty bet lettered like the felt.

## Acceptance criteria

From the issue: chips of 10, 50, 100 and 500 build the bet, piled as placed, next to "Tú" too, with a click on the piles taking back the top one and icon buttons to undo or clear; chips over 500 or the balance are off, and chips the balance no longer covers are cleared. A result pop-up with Repetir apuesta, Cambiar apuesta and Ver la mesa; the history shows what was lost. Card, chip and result sounds with a speaker toggle. Felt with the arc legend, a paced deal and the 3D hole-card flip; card places and the arc lettering before the deal. Mazos with three free backs and three priced and locked. The shuffle animation with its test button until #66. A two-column panel on wide screens. Tests for components and logic; Spanish copy.

## Checks

- `npm run lint`
- `npm run typecheck`
- `npm test -w frontend`

## Progress

- Planned. Issue #67 opened; the playtest commits of `feat/65-blackjack-split` moved to `feat/67-blackjack-table-polish`, grouped as T1-T3.
- Playtest round 2 (Juan Sebastián, after trying the split in #65): the pop-up's title and detail are smaller, so the result no longer fills its box and a split's per-hand lines stay quiet. Doblar and Separar put the action on top and "+10 créditos" below in the amount font, so the label no longer wraps as "Doblar ·" / "+10" in landscape; they are tinted (lilac and the felt's mint) instead of flat white, as is "Ver la mesa". The sound toggle is a speaker drawn in the app's icon stroke, in a round chip, instead of the word "Sonido". The synthesized snap is replaced by a recorded card (`card-deal.mp3`, 0.27 s, 4 KB): one card cut from Juan Sebastián's three-card recording (ElevenLabs), with the rumble high-passed, the background denoised and the room echo gated and faded out; `preloadCardSound` decodes it when the table shows. Checks: lint clean, typecheck clean, frontend 378 tests pass; the production build bundles the sound.
- Playtest round 3 (Juan Sebastián): the stake is built with casino chips of 10, 50, 100 and 500 credits instead of a number field; each click puts one chip on the bet with a clack, the bet shows them stacked with the fewest chips on a patch of felt, and Deshacer and Borrar take back the last one or all. A chip that would pass 500 credits or the balance is off. Doblar and Separar are quieter: outlined buttons in a lilac tray under Pedir and Plantarse, with the hint in small type inside it. A settled round sounds its result by the net over every hand (a rising arpeggio for a gain, two even notes for a push, a falling line for a loss), synthesized with Web Audio; chips and results share the table's sound toggle (`sound.ts`, formerly `cardSound.ts`). The pop-up's "Jugar otra vez" becomes "Repetir apuesta", which deals the next hand at once with the same stake, next to "Cambiar apuesta" and "Ver la mesa"; the side panel offers the same two. Checks: lint clean, typecheck clean, frontend 382 tests pass; checked in the browser at desktop and phone width.
- Playtest round 4 (Juan Sebastián): chips pile as they were put down instead of being colored up: two 50s stay two 50s, ten chips to a pile and a new pile beside it; a click on the piles takes back the top chip, and Deshacer and Borrar are icons. The bet's chips sit next to "Tú" on the felt, before the deal and during the round (each hand's after a split, twice on a doubled hand). Before the deal the felt shows two card places per side, lit in turn, instead of the dashed "Esperando el reparto" boxes. The shoe in the dealer's corner plays a shuffle animation (two halves riffled in, apart and in again, about 5.6 s, with soft card snaps); a shoe that runs down across hands needs a server-side shoe and goes in its own issue after this stack. "Así se paga" wraps on a narrow panel. Checks: lint clean, typecheck clean; frontend 389 tests pass; checked in the browser at desktop and phone width.
- Playtest round 5 (Juan Sebastián): a "Mazos" button beside "Barajar" opens the card-back designs over the felt. Clásico, Lila and Paño are free and used at once (kept in this browser); Ajedrez, Medianoche and Oro show a price in credits with a padlock and cannot be picked yet, since selling them must move credits through the wallet (README §2.3) and belongs with a shop. The design in use dresses the hole card, the shoe and the shuffle. Checks: lint clean, typecheck clean, frontend 392 tests pass; checked in the browser.
