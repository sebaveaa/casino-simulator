import type { BlackjackSettledHand } from "@casino/shared";
import { useId } from "react";
import { credits, roundSummary } from "./format";

/**
 * One pill: a gain shows what it gained, an even round its title, and a loss what it cost, after
 * a short reason when there is one (the tomato already says it was lost). Screen readers hear the
 * whole result: "Perdiste −10", "Blackjack de la banca −10".
 */
function Pill({ hand }: { hand: BlackjackSettledHand }) {
  const { title, net } = roundSummary(hand);
  if (net > 0n) return <>+{credits(net)}</>;
  if (net === 0n) return <>{title}</>;
  const cost = `−${credits(-net)}`;
  const [only] = hand.playerHands;
  const outcome = hand.playerHands.length === 1 ? only?.outcome : undefined;
  if (outcome === "bust") return <>Te pasaste {cost}</>;
  if (outcome === "dealer_blackjack") {
    return (
      <>
        Blackjack<span className="roulette-sr-only"> de la banca</span> {cost}
      </>
    );
  }
  return (
    <>
      <span className="roulette-sr-only">Perdiste </span>
      {cost}
    </>
  );
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
              <Pill hand={hand} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
