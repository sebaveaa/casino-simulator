import type { BlackjackSettledHand } from "@casino/shared";
import { useId } from "react";
import { credits, gainOf, isWin, OUTCOME_TITLES } from "./format";

/** "Tus últimas manos": a win shows what it gained on sun, anything else its outcome. */
export function HandHistory({ hands }: { hands: BlackjackSettledHand[] }) {
  const titleId = useId();
  if (hands.length === 0) return null;
  return (
    <div className="cr-history">
      <h2 id={titleId} className="cr-history-title">
        Tus últimas manos
      </h2>
      <ul className="cr-history-list" aria-labelledby={titleId}>
        {hands.map((hand) =>
          isWin(hand.outcome) ? (
            <li key={hand.handId} className="cr-history-pill is-win amount">
              +{credits(gainOf(hand.payout, hand.totalStake))}
            </li>
          ) : (
            <li
              key={hand.handId}
              className={hand.outcome === "push" ? "cr-history-pill" : "cr-history-pill is-lost"}
            >
              {OUTCOME_TITLES[hand.outcome]}
            </li>
          ),
        )}
      </ul>
    </div>
  );
}
