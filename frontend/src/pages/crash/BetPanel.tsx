import type { FormEvent } from "react";

/** Quick-stake buttons, in credits. */
const QUICK_STAKES = ["10", "50", "100", "500"] as const;

export interface BetPanelProps {
  amountText: string;
  submitting: boolean;
  locked: boolean;
  fieldError: string | null;
  error: string | null;
  onAmountChange: (text: string) => void;
  onSubmit: (event: FormEvent) => void;
}

/** "Tu apuesta": the stake field, quick amounts and the Apostar button. */
export function BetPanel({
  amountText,
  submitting,
  locked,
  fieldError,
  error,
  onAmountChange,
  onSubmit,
}: BetPanelProps) {
  const describedBy = fieldError ? "crash-stake-error" : undefined;
  return (
    <form className="crash-bet" onSubmit={onSubmit} noValidate>
      <label className="crash-bet-label" htmlFor="crash-stake">
        Monto de tu apuesta
      </label>
      <div className="crash-bet-field">
        <input
          id="crash-stake"
          className="crash-stake amount"
          type="number"
          inputMode="numeric"
          min={10}
          max={500}
          step={10}
          value={amountText}
          disabled={locked || submitting}
          aria-describedby={describedBy}
          aria-invalid={fieldError ? true : undefined}
          onChange={(event) => onAmountChange(event.target.value)}
        />
        <span className="crash-bet-unit">créditos</span>
      </div>
      <div className="crash-quick">
        {QUICK_STAKES.map((value) => (
          <button
            key={value}
            type="button"
            className="button button-secondary crash-quick-button"
            disabled={locked || submitting}
            onClick={() => onAmountChange(value)}
          >
            {value}
          </button>
        ))}
      </div>
      {fieldError && (
        <p id="crash-stake-error" className="crash-field-error" role="alert">
          {fieldError}
        </p>
      )}
      {error && (
        <p className="crash-error" role="alert">
          {error}
        </p>
      )}
      <button
        type="submit"
        className="button button-large crash-bet-submit"
        disabled={locked || submitting}
      >
        {submitting ? "Apostando…" : `Apostar · ${amountText || "0"} créditos`}
      </button>
    </form>
  );
}
