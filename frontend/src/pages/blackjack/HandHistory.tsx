import type { BlackjackSettledHand } from "@casino/shared";
import { useId } from "react";
import { credits, gainOf, isWin, OUTCOME_TITLES } from "./format";

/** One pill's text: a win shows what it gained, a loss its outcome and what it cost. */
function pillText(hand: BlackjackSettledHand): string {
  if (isWin(hand.outcome)) return `+${credits(gainOf(hand.payout, hand.totalStake))}`;
  if (hand.outcome === "push") return OUTCOME_TITLES.push;
  return `${OUTCOME_TITLES[hand.outcome]} −${credits(hand.totalStake)}`;
}

/** "Tus últimas manos": wins on sun, losses on tomato, a push plain. */
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
          const tone = isWin(hand.outcome) ? " is-win" : hand.outcome === "push" ? "" : " is-lost";
          return (
            <li key={hand.handId} className={`cr-history-pill amount${tone}`}>
              {pillText(hand)}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
