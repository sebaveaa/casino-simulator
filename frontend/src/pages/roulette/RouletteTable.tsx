import {
  pocketColor,
  type RouletteBet,
  type RouletteSelection,
  selectionKey,
} from "@casino/shared";
import type { CSSProperties } from "react";
import { chipTier } from "./chips";
import { MultBadge } from "./MultBadge";
import { shortCredits } from "./money";
import { DOZENS, GRID_ROWS, multiplierOf, selectionLabel, winsOn } from "./selections";

export interface RouletteTableProps {
  /** Chips on the felt, one stack per selection. */
  stacks: readonly RouletteBet[];
  /** Pocket that came up, once the wheel stopped: winning cells pulse and chips win or fade. */
  outcome: number | null;
  disabled: boolean;
  onPlace: (selection: RouletteSelection) => void;
}

type CellProps = {
  selection: RouletteSelection;
  label: string;
  className: string;
  style: CSSProperties;
};

/** The classic layout on green felt: the 0 column, the 3 x 12 grid, dozens and outside bets. */
export function RouletteTable({ stacks, outcome, disabled, onPlace }: RouletteTableProps) {
  const staked = new Map(stacks.map((bet) => [selectionKey(bet.selection), bet.stake]));

  function cell({ selection, label, className, style }: CellProps) {
    const key = selectionKey(selection);
    const placed = staked.get(key);
    const wins = outcome !== null && winsOn(selection, outcome);
    const description =
      `${selectionLabel(selection)}, retorno x${multiplierOf(selection)}` +
      (placed === undefined ? "" : `, apostado ${shortCredits(placed)} créditos`);
    return (
      <button
        key={key}
        type="button"
        className={`roulette-cell ${className}${wins ? " is-win" : ""}`}
        style={style}
        aria-label={description}
        disabled={disabled}
        onClick={() => onPlace(selection)}
      >
        <span className="roulette-cell-label">{label}</span>
        <MultBadge selection={selection} className="roulette-mult-tip" />
        {placed !== undefined && (
          <>
            <MultBadge selection={selection} className="roulette-mult-corner" />
            <span
              key={placed.toString()}
              className={`roulette-chip roulette-chip-on-cell ${chipTier(placed)}${
                outcome === null ? "" : wins ? " is-win" : " is-lose"
              }`}
            >
              {shortCredits(placed)}
            </span>
          </>
        )}
      </button>
    );
  }

  return (
    <div className="roulette-felt-scroll">
      <div className="roulette-felt">
        {cell({
          selection: { type: "straight", number: 0 },
          label: "0",
          className: "roulette-zero",
          style: { gridColumn: 1, gridRow: "1 / span 3" },
        })}
        {GRID_ROWS.map((row, r) =>
          row.map((n) =>
            cell({
              selection: { type: "straight", number: n },
              label: String(n),
              className: `roulette-num roulette-felt-${pocketColor(n)}`,
              style: { gridColumn: Math.ceil(n / 3) + 1, gridRow: r + 1 },
            }),
          ),
        )}
        {DOZENS.map((dozen) =>
          cell({
            selection: { type: "dozen", dozen },
            label: `${dozen}ª docena`,
            className: "roulette-outside",
            style: { gridColumn: `${(dozen - 1) * 4 + 2} / span 4`, gridRow: 4 },
          }),
        )}
        {cell({
          selection: { type: "parity", parity: "even" },
          label: "Par",
          className: "roulette-outside",
          style: { gridColumn: "2 / span 3", gridRow: 5 },
        })}
        {cell({
          selection: { type: "color", color: "red" },
          label: "Rojo",
          className: "roulette-outside roulette-diamond-red",
          style: { gridColumn: "5 / span 3", gridRow: 5 },
        })}
        {cell({
          selection: { type: "color", color: "black" },
          label: "Negro",
          className: "roulette-outside roulette-diamond-black",
          style: { gridColumn: "8 / span 3", gridRow: 5 },
        })}
        {cell({
          selection: { type: "parity", parity: "odd" },
          label: "Impar",
          className: "roulette-outside",
          style: { gridColumn: "11 / span 3", gridRow: 5 },
        })}
      </div>
    </div>
  );
}
