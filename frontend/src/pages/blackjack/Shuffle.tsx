import { type CSSProperties, useEffect } from "react";
import { prefersReducedMotion } from "../roulette/motion";
import { playCardSound } from "./sound";

/** Cards drawn per half of the deck, and the shuffle's timing (they match the CSS). */
const CARDS_PER_HALF = 8;
const PASS_MS = 1600;
const STAGGER_MS = 70;
/** Three passes: riffle in, split again, riffle in; then a moment to show the deck squared. */
export const SHUFFLE_MS = 3 * PASS_MS + CARDS_PER_HALF * STAGGER_MS + 500;
const REDUCED_SHUFFLE_MS = 900;
/** Where in a pass a card lands on the pile (the keyframes' 60%). */
const LAND_AT = 0.6;

/**
 * The shoe being shuffled, over the felt: the deck cut in two halves that riffle together card by
 * card, split again and riffle once more, each card with a soft snap. With reduced motion it only
 * says so for a moment. `onDone` runs when it ends.
 */
export function Shuffle({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const reduced = prefersReducedMotion();
    const timers = [setTimeout(onDone, reduced ? REDUCED_SHUFFLE_MS : SHUFFLE_MS)];
    if (!reduced) {
      // The first and third passes riffle the cards in; the second lifts them back apart.
      for (const pass of [0, 2]) {
        for (let k = 0; k < CARDS_PER_HALF; k++) {
          for (const offset of [0, STAGGER_MS / 2]) {
            const at = pass * PASS_MS + k * STAGGER_MS + offset + LAND_AT * PASS_MS;
            timers.push(setTimeout(() => playCardSound(0.3), at));
          }
        }
      }
    }
    return () => timers.forEach(clearTimeout);
  }, [onDone]);

  return (
    <div className="bj-shuffle" role="status">
      <div className="bj-shuffle-deck" aria-hidden="true">
        {Array.from({ length: CARDS_PER_HALF * 2 }, (_, i) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: the cards are identical and never move in the list
            key={i}
            className={i % 2 === 0 ? "bj-shuffle-card" : "bj-shuffle-card is-right"}
            style={{ "--k": Math.floor(i / 2), "--i": i } as CSSProperties}
          />
        ))}
      </div>
      <p className="bj-shuffle-text">Barajando el zapato…</p>
    </div>
  );
}
