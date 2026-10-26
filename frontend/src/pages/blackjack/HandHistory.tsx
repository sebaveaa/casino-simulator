import type { BlackjackSettledHand } from "@casino/shared";
import { useId } from "react";
import { credits, roundSummary } from "./format";

/** One pill's text: a gain shows what it gained, a loss its result and what it cost. */
function pillText(hand: BlackjackSettledHand): string {
  const { title, net } = roundSummary(hand);
  if (net > 0n) return `+${credits(net)}`;
  if (net === 0n) return title;
  return `${title} −${credits(-net)}`;
}

/** "Tus últimas manos": gains on sun, losses on tomato, even rounds plain. */
export function HandHistory({ hands }: { hands: BlackjackSettledHand[] }) {
  const titleId = useId();
  if (hands.length === 0) return null;
  return (
    <div className="cr-history">
      <h2 id={titleId} className="cr-history-title">
        Tus últimas manos
      </h2>
      <ul className="cr-history-list" aria-labelledby={titleId}>
        {hands.map((hand) => {
          const { tone } = roundSummary(hand);
          const toneClass = tone === "won" ? " is-win" : tone === "lost" ? " is-lost" : "";
          return (
            <li key={hand.handId} className={`cr-history-pill amount${toneClass}`}>
              {pillText(hand)}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
