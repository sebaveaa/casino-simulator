import type { CrashRound } from "@casino/shared";
import { formatMultiplier } from "./format";

/** "Últimas rondas": one pill per finished round, tomato under 2x and sun at 2x or more. */
export function CrashHistory({ rounds }: { rounds: CrashRound[] }) {
  const finished = rounds.filter((round) => round.result !== undefined);
  if (finished.length === 0) return null;
  return (
    <section className="crash-history" aria-label="Últimas rondas">
      <h2 className="crash-history-title">Últimas rondas</h2>
      <ul className="crash-history-list">
        {finished.map((round) => {
          const hundredths = round.result?.crashHundredths ?? 100;
          const high = hundredths >= 200;
          return (
            <li key={round.id} className="crash-pill" data-tone={high ? "sun" : "tomato"}>
              {formatMultiplier(hundredths)}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
