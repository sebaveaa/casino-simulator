import { CHIP_VALUES, type ChipValue, chipAmount, chipTier } from "./chips";

export interface ChipRackProps {
  selected: ChipValue;
  onSelect: (value: ChipValue) => void;
}

/** The chips to pick from; the selected one is lifted and ringed. */
export function ChipRack({ selected, onSelect }: ChipRackProps) {
  return (
    <fieldset className="roulette-rack">
      <legend className="roulette-sr-only">Fichas</legend>
      {CHIP_VALUES.map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={selected === value}
          aria-label={`Ficha de ${value} ${value === 1 ? "crédito" : "créditos"}`}
          className={`roulette-chip roulette-rack-chip ${chipTier(chipAmount(value))}`}
          onClick={() => onSelect(value)}
        >
          {value}
        </button>
      ))}
    </fieldset>
  );
}
