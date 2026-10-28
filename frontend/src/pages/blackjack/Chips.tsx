import type { CSSProperties } from "react";
import { type ChipValue, pilesOf } from "./format";

/** A casino chip: its value in the middle, its color by denomination. */
export function Chip({ value }: { value: ChipValue }) {
  return (
    <span className={`bj-chip is-${value}`}>
      <span className="bj-chip-value amount">{value}</span>
    </span>
  );
}

/**
 * Chips stacked as they were put down, seen from the player's seat: a pile holds ten, and the
 * next chip starts a pile beside it. With `onTakeTop` the piles are a button that takes back the
 * chip on top, the last one put down. `sm` is the size on the felt, next to a hand.
 */
export function ChipPiles({
  chips,
  size = "md",
  onTakeTop,
  disabled = false,
}: {
  chips: readonly ChipValue[];
  size?: "sm" | "md";
  onTakeTop?: () => void;
  disabled?: boolean;
}) {
  const piles = pilesOf(chips).map((pile, p) => (
    // Piles and the chips in them keep their place: the position is their identity.
    // biome-ignore lint/suspicious/noArrayIndexKey: a pile never moves
    <span key={p} className="bj-pile" style={{ "--count": pile.length } as CSSProperties}>
      {pile.map((value, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a chip never moves within its pile
        <span key={i} className="bj-pile-chip" style={{ "--i": i } as CSSProperties}>
          <Chip value={value} />
        </span>
      ))}
    </span>
  ));
  const className = `bj-piles is-${size}`;
  const top = chips.at(-1);
  if (onTakeTop && top !== undefined) {
    return (
      <button
        type="button"
        className={className}
        aria-label={`Quitar la ficha de ${top} créditos`}
        title="Quitar la ficha de arriba"
        disabled={disabled}
        onClick={onTakeTop}
      >
        {piles}
      </button>
    );
  }
  return (
    <span className={className} aria-hidden="true">
      {piles}
    </span>
  );
}
