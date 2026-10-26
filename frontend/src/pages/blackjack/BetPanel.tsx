import { useId } from "react";
import { credits, QUICK_STAKES, stakeFromInput } from "./format";

/** "Apuesta": the stake field, the quick amounts, the deal button and how hands pay. */
export function BetPanel({
  amount,
  onAmount,
  onStart,
  disabled,
}: {
  /** The field's text, in whole credits. */
  amount: string;
  onAmount: (text: string) => void;
  onStart: (stake: string) => void;
  disabled: boolean;
}) {
  const inputId = useId();
  const helpId = useId();
  const payId = useId();
  const stake = stakeFromInput(amount);
  const label = stake === null ? amount.trim() || "0" : credits(stake);

  return (
    <div className="cr-panel-body">
      <div className="cr-field">
        <label htmlFor={inputId} className="cr-field-label">
          Tu apuesta
        </label>
        <div className="cr-field-row">
          <input
            id={inputId}
            className="cr-stake-input"
            type="number"
            inputMode="numeric"
            min={10}
            max={500}
            step={10}
            value={amount}
            aria-describedby={helpId}
            aria-invalid={stake === null || undefined}
            disabled={disabled}
            onChange={(event) => onAmount(event.target.value)}
          />
          <span>créditos</span>
        </div>
        <p id={helpId} className="cr-help">
          Entre 10 y 500 créditos.
        </p>
      </div>

      <div className="cr-quick">
        {QUICK_STAKES.map((value) => {
          const selected = amount.trim() === String(value);
          return (
            <button
              key={value}
              type="button"
              className={selected ? "cr-quick-button is-selected" : "cr-quick-button"}
              aria-pressed={selected}
              disabled={disabled}
              onClick={() => onAmount(String(value))}
            >
              {value}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        className="button button-large cr-primary"
        disabled={disabled || stake === null}
        onClick={() => stake !== null && onStart(stake)}
      >
        Repartir · {label} créditos
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
          Gana quien quede más cerca de 21 sin pasarse. La banca pide hasta llegar a 17. Puedes
          doblar con tus dos primeras cartas: recibes una carta más y te plantas.
        </p>
      </section>
    </div>
  );
}
