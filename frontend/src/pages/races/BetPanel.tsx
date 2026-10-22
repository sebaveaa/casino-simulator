import type { FormEvent } from "react";
import { animals } from "./animals";
import { limitsInCredits, type StakeLimits } from "./stake";

export interface BetPanelProps {
  selected: number | null;
  amountText: string;
  /** Nothing can be changed or sent: a bet is already placed, or betting closed. */
  locked: boolean;
  submitting: boolean;
  /** The server's stake limits; null while they are unknown (the form stays locked). */
  limits: StakeLimits | null;
  fieldError: string | null;
  error: string | null;
  onSelect: (animal: number) => void;
  onAmountChange: (text: string) => void;
  onSubmit: (event: FormEvent) => void;
}

/** The five runners as a radio group, the stake and "Apostar". It only collects the choice. */
export function BetPanel({
  selected,
  amountText,
  locked,
  submitting,
  limits,
  fieldError,
  error,
  onSelect,
  onAmountChange,
  onSubmit,
}: BetPanelProps) {
  const disabled = locked || submitting || limits === null;
  const message = fieldError ?? error;
  return (
    <form className="races-form" onSubmit={onSubmit} noValidate>
      <div className="races-animals" role="radiogroup" aria-labelledby="race-animals-title">
        <p id="race-animals-title" className="races-animals-title">
          Elija un animal
        </p>
        {animals.map((animal) => (
          <label key={animal.id} className="races-animal">
            <input
              type="radio"
              name="race-animal"
              className="races-radio"
              value={animal.id}
              checked={selected === animal.id}
              disabled={disabled}
              onChange={() => onSelect(animal.id)}
            />
            <span className="races-animal-emoji" aria-hidden="true">
              {animal.emoji}
            </span>
            <span className="races-animal-name">{animal.name}</span>
            <span className="races-animal-lane">Carril {animal.id + 1}</span>
          </label>
        ))}
      </div>

      <label htmlFor="race-stake" className="races-stake-label">
        Monto en créditos
      </label>
      <div className="races-stake-row">
        <input
          id="race-stake"
          className="wallet-input"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={amountText}
          disabled={disabled}
          onChange={(event) => onAmountChange(event.target.value)}
          aria-invalid={fieldError ? true : undefined}
          aria-describedby={message ? "race-stake-hint race-bet-error" : "race-stake-hint"}
        />
        <button type="submit" className="button races-submit" disabled={disabled}>
          {submitting ? "Apostando…" : "Apostar"}
        </button>
      </div>
      <p id="race-stake-hint" className="races-hint">
        {limits
          ? `Mínimo ${limitsInCredits(limits).min}, máximo ${limitsInCredits(limits).max} créditos. `
          : ""}
        Si su animal gana, recibe 4,5 veces lo apostado.
      </p>
      {message && (
        <p id="race-bet-error" className="wallet-error races-error" role="alert">
          {message}
        </p>
      )}
    </form>
  );
}
