import { MINOR_UNITS_PER_CREDIT, type Money } from "@casino/shared";
import { useId } from "react";
import { Chip, ChipPiles } from "./Chips";
import { FeltArc } from "./FeltArc";
import { CHIP_VALUES, type ChipValue, MAX_BET_CREDITS, stakeOfCredits } from "./format";
import { playChipSound } from "./sound";

/** An arrow turning back: take back the last chip. */
function UndoIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7 4L3 8l4 4" />
      <path d="M3 8h9a5 5 0 0 1 0 10H8" />
    </svg>
  );
}

/** A bin: take every chip off the bet. */
function ClearIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 5h14M8 5V3h4v2M5 5l1 12h8l1-12" />
      <path d="M8.5 9v5M11.5 9v5" />
    </svg>
  );
}

/**
 * "Apuesta": chips build the stake, one click per chip. They pile on a patch of felt as they were
 * put down; a click on the piles takes back the chip on top, and the icons take back the last one
 * or all of them. Then the deal button and how hands pay. On a wide panel the felt patch keeps a
 * small width on the left and the chips and the deal button sit on the right.
 */
export function BetPanel({
  chips,
  onAdd,
  onTakeBack,
  onClear,
  onStart,
  balance,
  disabled,
}: {
  /** The chips on the bet, in the order they were put down, in credits. */
  chips: readonly ChipValue[];
  onAdd: (chip: ChipValue) => void;
  /** Takes back the last chip put down. */
  onTakeBack: () => void;
  onClear: () => void;
  onStart: (stake: string) => void;
  /** Null while it loads: the server still refuses a stake it cannot cover. */
  balance: Money | null;
  disabled: boolean;
}) {
  const betId = useId();
  const payId = useId();
  const total = chips.reduce((sum, chip) => sum + chip, 0);
  const stake = stakeOfCredits(total);
  // Whole credits the balance covers; chips beyond it stay off.
  const affordable = balance === null ? Infinity : Number(balance / MINOR_UNITS_PER_CREDIT);
  const room = Math.min(MAX_BET_CREDITS, affordable) - total;
  const empty = chips.length === 0;

  return (
    <div className="cr-panel-body">
      <div className="bj-panel-main">
        <div className="bj-bet">
          <div className="bj-bet-head">
            <span id={betId} className="cr-field-label">
              Tu apuesta
            </span>
            <output className="bj-bet-total amount" aria-labelledby={betId} aria-live="polite">
              {total} créditos
            </output>
          </div>
          <div className="bj-bet-spot">
            {empty ? (
              <FeltArc
                main="TOCA UNA FICHA"
                sub="PARA APOSTAR"
                spoken="Toca una ficha para apostar"
                shape="spot"
              />
            ) : (
              <ChipPiles chips={chips} disabled={disabled} onTakeTop={onTakeBack} />
            )}
            <div className="bj-bet-tools">
              <button
                type="button"
                className="bj-bet-tool"
                aria-label="Deshacer la última ficha"
                title="Deshacer la última ficha"
                disabled={disabled || empty}
                onClick={onTakeBack}
              >
                <UndoIcon />
              </button>
              <button
                type="button"
                className="bj-bet-tool"
                aria-label="Borrar la apuesta"
                title="Borrar la apuesta"
                disabled={disabled || empty}
                onClick={onClear}
              >
                <ClearIcon />
              </button>
            </div>
          </div>
        </div>

        <div className="bj-panel-controls">
          <fieldset className="bj-chips">
            <legend className="roulette-sr-only">Fichas</legend>
            {CHIP_VALUES.map((value) => (
              <button
                key={value}
                type="button"
                className="bj-chip-button"
                aria-label={`Ficha de ${value} créditos`}
                disabled={disabled || value > room}
                onClick={() => {
                  playChipSound();
                  onAdd(value);
                }}
              >
                <Chip value={value} />
              </button>
            ))}
          </fieldset>
          <p className="cr-help">Cada ficha suma a tu apuesta: entre 10 y 500 créditos.</p>

          <button
            type="button"
            className="button button-large cr-primary"
            disabled={disabled || stake === null}
            onClick={() => stake !== null && onStart(stake)}
          >
            {stake === null ? "Repartir" : `Repartir · ${total} créditos`}
          </button>
        </div>
      </div>

      <section className="cr-paytable" aria-labelledby={payId}>
        <h2 id={payId} className="cr-subtitle">
          Así se paga
        </h2>
        <dl className="cr-paytable-grid">
          <div className="cr-paytable-item">
            <dt>Blackjack</dt>
            <dd className="amount">3:2</dd>
          </div>
          <div className="cr-paytable-item">
            <dt>Ganar</dt>
            <dd className="amount">1:1</dd>
          </div>
          <div className="cr-paytable-item">
            <dt>Empate</dt>
            <dd className="amount">Devuelve</dd>
          </div>
        </dl>
        <p className="cr-note">
          Gana quien quede más cerca de 21 sin pasarse. La banca pide hasta llegar a 17. Con tus dos
          primeras cartas puedes doblar (recibes una carta más y te plantas) o, si son un par,
          separarlas en dos manos.
        </p>
      </section>
    </div>
  );
}
