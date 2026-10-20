import { parseAmount } from "@casino/shared";
import { animalName, animals } from "./animals";
import type { MyBet } from "./raceState";
import { creditsText } from "./stake";

/** The player's line under the winner. Amounts come from the API: the page computes none. */
function playerLine(settled: boolean, myBet: MyBet | null): { text: string; win: boolean } {
  if (!settled) return { text: "Liquidando apuestas…", win: false };
  if (!myBet) return { text: "No apostó en esta carrera.", win: false };
  if (myBet.payout === null) return { text: "Calculando su resultado…", win: false };
  if (parseAmount(myBet.payout) > 0n)
    return { text: `Ganó ${creditsText(myBet.payout)}`, win: true };
  return { text: `Perdió ${creditsText(myBet.stake)}`, win: false };
}

/** Winner of the round and what it meant for the player. */
export function RaceOutcome({
  winner,
  settled,
  myBet,
}: {
  winner: number;
  settled: boolean;
  myBet: MyBet | null;
}) {
  const line = playerLine(settled, myBet);
  return (
    <div className={line.win ? "races-outcome is-win" : "races-outcome"}>
      <span className="races-outcome-emoji" aria-hidden="true">
        {animals[winner]?.emoji ?? "🏁"}
      </span>
      <div className="races-outcome-body">
        <p className="races-outcome-winner">Ganador: {animalName(winner)}</p>
        <p className="races-outcome-line">{line.text}</p>
      </div>
    </div>
  );
}
