import {
  formatCredits,
  type PocketColor,
  parseAmount,
  pocketColor,
  type RouletteBetResponse,
  type RouletteSelection,
} from "@casino/shared";
import { type FormEvent, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { ApiError, useApi } from "../api";
import { BALANCE_LOADING, useBalance, useRefreshBalance } from "../app/useBalance";
import { creditsToAmount } from "./creditsInput";
import { PrototypeSwitcher } from "./roulette/prototype/PrototypeSwitcher";
import { VariantA } from "./roulette/prototype/VariantA";
import { VariantB } from "./roulette/prototype/VariantB";
import { RouletteWheel } from "./roulette/RouletteWheel";

const COLOR_NAMES: Record<PocketColor, string> = { red: "rojo", black: "negro", green: "verde" };

const NUMBERS = Array.from({ length: 37 }, (_, n) => n);

const OUTSIDE_BETS: { label: string; selection: RouletteSelection }[] = [
  { label: "Rojo", selection: { type: "color", color: "red" } },
  { label: "Negro", selection: { type: "color", color: "black" } },
  { label: "Par", selection: { type: "parity", parity: "even" } },
  { label: "Impar", selection: { type: "parity", parity: "odd" } },
  { label: "1ª docena (1-12)", selection: { type: "dozen", dozen: 1 } },
  { label: "2ª docena (13-24)", selection: { type: "dozen", dozen: 2 } },
  { label: "3ª docena (25-36)", selection: { type: "dozen", dozen: 3 } },
];

function sameSelection(a: RouletteSelection | null, b: RouletteSelection | null): boolean {
  return a !== null && b !== null && JSON.stringify(a) === JSON.stringify(b);
}

function describeSelection(selection: RouletteSelection): string {
  if (selection.type === "straight") return `Número ${selection.number}`;
  return OUTSIDE_BETS.find((bet) => sameSelection(bet.selection, selection))?.label ?? "";
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "insufficient_funds") return "Saldo insuficiente.";
    if (error.code === "network") return "No hay conexión con el servidor. Intente de nuevo.";
    if (error.code === "unauthorized") return "Inicie sesión para continuar.";
    if (error.code === "invalid_request") return "La apuesta no es válida.";
  }
  return "Ocurrió un error inesperado. Intente de nuevo.";
}

type Round = { response: RouletteBetResponse; stake: string };

/** PROTOTYPE gate — throwaway, see branch prototype/12-roulette-table. */
export function RoulettePage() {
  const [params] = useSearchParams();
  if (!import.meta.env.DEV) return <CurrentRoulette />;
  const variant = params.get("variant");
  return (
    <>
      {variant === "A" ? <VariantA /> : variant === "B" ? <VariantB /> : <CurrentRoulette />}
      <PrototypeSwitcher />
    </>
  );
}

/** Roulette table: the server draws the number, the wheel only animates it (README §4.2). */
function CurrentRoulette() {
  const api = useApi();
  const balance = useBalance();
  const refreshBalance = useRefreshBalance();

  const [stakeText, setStakeText] = useState("10");
  const [selection, setSelection] = useState<RouletteSelection | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [round, setRound] = useState<Round | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [spinId, setSpinId] = useState(0);

  // One Idempotency-Key per bet: retrying the same bet after a network failure reuses it.
  const pendingKey = useRef<{ signature: string; key: string } | null>(null);

  const busy = submitting || spinning;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const stake = creditsToAmount(stakeText);
    if (stake === null) {
      setFieldError("Ingrese una apuesta mayor que cero, con hasta dos decimales.");
      return;
    }
    if (selection === null) {
      setFieldError("Elija a qué desea apostar.");
      return;
    }
    setFieldError(null);
    setError(null);

    const signature = JSON.stringify({ stake, selection });
    if (pendingKey.current?.signature !== signature) {
      pendingKey.current = { signature, key: crypto.randomUUID() };
    }
    const { key } = pendingKey.current;

    setSubmitting(true);
    try {
      const response = await api.placeRouletteBet({ stake, selection }, key);
      pendingKey.current = null;
      setRound({ response, stake });
      setRevealed(false);
      setSpinning(true);
      setSpinId((id) => id + 1);
    } catch (caught) {
      if (!(caught instanceof ApiError && caught.code === "network")) pendingKey.current = null;
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  function onSpinEnd() {
    setSpinning(false);
    setRevealed(true);
    void refreshBalance();
  }

  const result = round && revealed ? round : null;
  const won = result ? parseAmount(result.response.payout) > 0n : false;

  return (
    <div className="roulette">
      <h1>Ruleta</h1>

      <p className="roulette-balance">
        Saldo:{" "}
        <strong className="amount" data-loading={balance === BALANCE_LOADING || undefined}>
          {balance}
        </strong>{" "}
        créditos
      </p>

      <div className="roulette-layout">
        <section className="wallet-card roulette-stage" aria-label="Rueda">
          <RouletteWheel
            target={round ? round.response.result.number : null}
            spinId={spinId}
            onSpinEnd={onSpinEnd}
          />
          <div aria-live="polite" role="status" className="roulette-result">
            {result && (
              <>
                <p className="roulette-number">
                  Salió el{" "}
                  <strong className={`pocket pocket-${pocketColor(result.response.result.number)}`}>
                    {result.response.result.number}
                  </strong>{" "}
                  ({COLOR_NAMES[pocketColor(result.response.result.number)]}).
                </p>
                <p className={won ? "wallet-ok" : "wallet-error"}>
                  {won
                    ? `Ganaste ${formatCredits(parseAmount(result.response.payout))} créditos.`
                    : `Perdiste ${formatCredits(BigInt(result.stake))} créditos.`}
                </p>
              </>
            )}
          </div>
          {result && (
            <details className="roulette-fairness">
              <summary>Datos de equidad</summary>
              <dl>
                <dt>Hash del server seed</dt>
                <dd className="amount">{result.response.fairness.serverSeedHash}</dd>
                <dt>Client seed</dt>
                <dd className="amount">{result.response.fairness.clientSeed}</dd>
                <dt>Nonce</dt>
                <dd className="amount">{result.response.fairness.nonce}</dd>
              </dl>
            </details>
          )}
        </section>

        <form className="wallet-card roulette-form" onSubmit={submit} noValidate>
          <label htmlFor="roulette-stake">Apuesta en créditos</label>
          <input
            id="roulette-stake"
            className="wallet-input"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={stakeText}
            onChange={(e) => setStakeText(e.target.value)}
            disabled={busy}
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={fieldError ? "roulette-error" : undefined}
          />

          <fieldset className="roulette-fieldset">
            <legend>Número</legend>
            <div className="roulette-numbers">
              {NUMBERS.map((n) => {
                const choice: RouletteSelection = { type: "straight", number: n };
                return (
                  <button
                    key={n}
                    type="button"
                    className={`roulette-chip pocket-${pocketColor(n)}`}
                    aria-pressed={sameSelection(selection, choice)}
                    aria-label={`Número ${n}`}
                    disabled={busy}
                    onClick={() => setSelection(choice)}
                  >
                    {n}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <fieldset className="roulette-fieldset">
            <legend>Apuestas externas</legend>
            <div className="roulette-outside">
              {OUTSIDE_BETS.map((bet) => (
                <button
                  key={bet.label}
                  type="button"
                  className="button button-secondary"
                  aria-pressed={sameSelection(selection, bet.selection)}
                  disabled={busy}
                  onClick={() => setSelection(bet.selection)}
                >
                  {bet.label}
                </button>
              ))}
            </div>
          </fieldset>

          <p className="roulette-chosen">
            {selection
              ? `Apuesta elegida: ${describeSelection(selection)}`
              : "Sin apuesta elegida."}
          </p>

          <button type="submit" className="button" disabled={busy}>
            {submitting ? "Enviando…" : spinning ? "Girando…" : "Girar"}
          </button>

          {fieldError && (
            <p id="roulette-error" className="wallet-error" role="alert">
              {fieldError}
            </p>
          )}
          {error && (
            <p className="wallet-error" role="alert">
              {error}
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
