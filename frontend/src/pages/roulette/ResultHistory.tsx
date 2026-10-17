import { pocketColor } from "@casino/shared";

export type HistoryEntry = { id: string; number: number };

/** Results kept in the strip. */
export const HISTORY_LIMIT = 12;

/** The last results of this visit, newest first and larger; session memory only. */
export function ResultHistory({ entries }: { entries: readonly HistoryEntry[] }) {
  return (
    <ol className="roulette-history" aria-label="Últimos resultados">
      {entries.length === 0 && <li className="roulette-history-empty">Sin giros aún</li>}
      {entries.map((entry, i) => (
        <li
          key={entry.id}
          className={`roulette-dot pocket-${pocketColor(entry.number)}${i === 0 ? " is-latest" : ""}`}
          title={`Salió el ${entry.number}`}
        >
          {entry.number}
        </li>
      ))}
    </ol>
  );
}
