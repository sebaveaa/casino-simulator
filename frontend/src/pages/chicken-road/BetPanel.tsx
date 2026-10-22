import { CHICKEN_ROAD_MULTIPLIERS } from "@casino/shared";
import { useId } from "react";
import { credits, formatMultiplier, QUICK_STAKES, stakeFromInput } from "./format";

/** "Apuesta": the stake field, the quick amounts, the start button and the payout table. */
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
        Empezar · {label} créditos
      </button>

      <section className="cr-paytable" aria-labelledby={`${inputId}-pay`}>
        <h2 id={`${inputId}-pay`} className="cr-subtitle">
          Así se paga
        </h2>
        <dl className="cr-paytable-grid">
          {CHICKEN_ROAD_MULTIPLIERS.map((multiplier, index) => (
            <div key={multiplier} className="cr-paytable-item">
              <dt>Carril {index + 1}</dt>
              <dd className="amount">{formatMultiplier(multiplier)}</dd>
            </div>
          ))}
        </dl>
        <p className="cr-note">
          Cada carril tiene 80 % de probabilidad de cruzarlo. Si te atropellan, pierdes la apuesta.
        </p>
      </section>
    </div>
  );
}
