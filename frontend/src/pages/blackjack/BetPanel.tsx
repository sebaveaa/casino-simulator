import { MINOR_UNITS_PER_CREDIT, type Money } from "@casino/shared";
import { useId } from "react";
import { CHIP_VALUES, type ChipValue, chipsFor, MAX_BET_CREDITS, stakeOfCredits } from "./format";
import { playChipSound } from "./sound";

/** A casino chip: its value in the middle, its color by denomination. */
export function Chip({ value }: { value: ChipValue }) {
  return (
    <span className={`bj-chip is-${value}`}>
      <span className="bj-chip-value amount">{value}</span>
    </span>
  );
}

/**
 * "Apuesta": chips build the stake, one click per chip. The bet stacks them the way a dealer
 * would, with the fewest chips; Deshacer takes back the last one, Borrar all of them. Then the
 * deal button and how hands pay.
 */
export function BetPanel({
  chips,
  onChips,
  onStart,
  balance,
  disabled,
}: {
  /** The chips on the bet, in the order they were put down, in credits. */
  chips: readonly ChipValue[];
  onChips: (chips: ChipValue[]) => void;
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

  return (
    <div className="cr-panel-body">
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
          {total === 0 ? (
            <span className="bj-bet-empty">Toca una ficha para apostar</span>
          ) : (
            <span className="bj-bet-stack" aria-hidden="true">
              {chipsFor(total).map((value, i) => (
                // A stack is drawn bottom up; the position is its identity.
                // biome-ignore lint/suspicious/noArrayIndexKey: chips in a stack keep their place
                <span key={i} className="bj-bet-chip" style={{ bottom: `${i * 9}px` }}>
                  <Chip value={value} />
                </span>
              ))}
            </span>
          )}
        </div>
        <div className="bj-bet-tools">
          <button
            type="button"
            className="bj-bet-tool"
            disabled={disabled || chips.length === 0}
            onClick={() => onChips(chips.slice(0, -1))}
          >
            Deshacer
          </button>
          <button
            type="button"
            className="bj-bet-tool"
            disabled={disabled || chips.length === 0}
            onClick={() => onChips([])}
          >
            Borrar
          </button>
        </div>
      </div>

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
              onChips([...chips, value]);
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
