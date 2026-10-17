import type { RouletteSelection } from "@casino/shared";
import { multiplierOf } from "./selections";

/** "x2", "x3" or "x36": what the selection returns per unit staked, coloured by risk. */
export function MultBadge({
  selection,
  className = "",
}: {
  selection: RouletteSelection;
  className?: string;
}) {
  const multiplier = multiplierOf(selection).toString();
  return (
    <span className={`roulette-mult roulette-mult-${multiplier} ${className}`.trim()}>
      x{multiplier}
    </span>
  );
}
