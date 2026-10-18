import { formatCredits, parseAmount, pocketColor, type RouletteBetResponse } from "@casino/shared";
import { useEffect, useState } from "react";
import { MultBadge } from "./MultBadge";
import { shortCredits, signedCredits } from "./money";
import { prefersReducedMotion } from "./motion";
import { CoinIcon } from "./SummaryIcons";
import { COLOR_NAMES, shortLabel } from "./selections";

/** 0: what the bets returned, 1: what they cost, 2: the net. */
type Step = 0 | 1 | 2;

const STEP_MS = 700;

/**
 * The outcome of a spin as a short sequence: the pocket, then +won, then -staked, then
 * "= net" with a tag, and the winning bets as chips. A click shows the end at once, and the
 * sequence is skipped under reduced motion. A screen reader gets one sentence instead.
 */
export function SpinResult({ response }: { response: RouletteBetResponse }) {
  const number = response.result.number;
  const color = pocketColor(number);
  const staked = parseAmount(response.stake);
  const won = parseAmount(response.payout);
  const net = won - staked;
  const tag = net > 0n ? "¡Gana!" : won > 0n ? "Parcial" : "Pierde";
  const winners = response.bets.filter((bet) => parseAmount(bet.payout) > 0n);

  const [step, setStep] = useState<Step>(() => (prefersReducedMotion() ? 2 : won > 0n ? 0 : 1));
  useEffect(() => {
    if (step >= 2) return;
    const id = window.setTimeout(() => setStep((current) => (current + 1) as Step), STEP_MS);
    return () => window.clearTimeout(id);
  }, [step]);
  const done = step === 2;

  return (
    <div className={`roulette-result${net > 0n ? " is-win" : ""}`}>
      <span className={`roulette-token pocket-${color}`}>{number}</span>
      <div className="roulette-result-body">
        {step === 0 && (
          <div className="roulette-result-line roulette-step">
            <CoinIcon />
            <span className="amount roulette-result-amount is-up">+{shortCredits(won)}</span>
          </div>
        )}
        {step === 1 && (
          <div className="roulette-result-line roulette-step">
            {won > 0n && (
              <span className="amount roulette-step-small is-up">+{shortCredits(won)}</span>
            )}
            <span className="amount roulette-result-amount is-down">−{shortCredits(staked)}</span>
          </div>
        )}
        {done && (
          <div className="roulette-result-line roulette-step">
            <CoinIcon />
            <span className="roulette-eq">=</span>
            <span
              className={`amount roulette-result-amount ${net >= 0n ? "is-up" : "is-down"}`}
              data-testid="spin-net"
            >
              {signedCredits(net)}
            </span>
            <span className="roulette-tag">{tag}</span>
          </div>
        )}
        <div className="roulette-result-meta">
          {done && (
            <span className="roulette-breakdown amount" aria-hidden="true">
              <span className="is-up">+{shortCredits(won)}</span>{" "}
              <span className="is-down">−{shortCredits(staked)}</span>
            </span>
          )}
          {winners.length > 0 && (
            <ul className="roulette-wins" aria-label="Apuestas ganadoras">
              {winners.map((bet) => (
                <li key={shortLabel(bet.selection)} className="roulette-win-chip">
                  {shortLabel(bet.selection)}
                  <MultBadge selection={bet.selection} className="roulette-mult-small" />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {!done && (
        <button
          type="button"
          className="roulette-result-skip"
          aria-label="Mostrar el resultado final"
          onClick={() => setStep(2)}
        />
      )}
      <span className="roulette-sr-only">
        {`Salió el ${number}, ${COLOR_NAMES[color]}. Recibió ${formatCredits(won)} créditos, apostó ${formatCredits(staked)} créditos. Resultado neto: ${formatCredits(net)} créditos.`}
      </span>
    </div>
  );
}
