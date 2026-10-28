import { formatMultiplier } from "./format";

export interface MultiplierProps {
  hundredths: number;
  /** "flying" rises in white, "impact" is tomato, "cap" is sun, "idle" is muted. */
  tone: "idle" | "flying" | "impact" | "cap";
}

/** The large live multiplier, two decimals with a comma (e.g. `2,45x`). */
export function Multiplier({ hundredths, tone }: MultiplierProps) {
  return (
    <p className="crash-multiplier" data-tone={tone} aria-live="off">
      {formatMultiplier(hundredths)}
    </p>
  );
}
