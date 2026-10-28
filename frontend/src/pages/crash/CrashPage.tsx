import { type CrashGame, type CrashRound, crashPayout, parseAmount } from "@casino/shared";
import {
  type ComponentType,
  type FormEvent,
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { Link } from "react-router";
import { ApiError, useApi } from "../../api";
import { newUuid } from "../../api/uuid";
import {
  BALANCE_LOADING,
  useApplyBalance,
  useBalance,
  useRefreshBalance,
} from "../../app/useBalance";
import "./crash.css";
import { BetPanel } from "./BetPanel";
import { Countdown } from "./Countdown";
import { CrashFairness } from "./CrashFairness";
import { CrashHistory } from "./CrashHistory";
import { crashReducer, initialCrashState } from "./crashState";
import {
  creditsFromAmount,
  creditsFromMinor,
  formatMultiplier,
  limitsInCredits,
  stakeMinorFromCredits,
} from "./format";
import { Multiplier } from "./Multiplier";
import type { CrashStageProps } from "./stageTypes";
import { useLiveMultiplier } from "./useLiveMultiplier";

/** Everything that differs between Dino Crash and Despegue; the engine and the flow are shared. */
export interface CrashGameConfig {
  game: CrashGame;
  title: string;
  /** aria-label of the scene: "Pista" / "Cielo". */
  stageLabel: string;
  Stage: ComponentType<CrashStageProps>;
  /** Headline when the round crashes, e.g. `(x) => \`¡Impacto! ${x}\``. */
  impactText: (multiplier: string) => string;
  /** Headline when the round reaches the 20.00x cap. */
  capText: string;
}

const DEFAULT_STAKE = "10";

/** Permanent "how to play" line, so the shared-round flow is never a surprise. */
const HOW_TO =
  "Cómo jugar: 1) apuesta antes del despegue; 2) cuando despegue, pulsa Retirar (o Enter / Espacio) antes del impacto.";

function betError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "insufficient_funds") return "Saldo insuficiente.";
    if (error.code === "conflict") return "Ya tienes una apuesta en esta ronda.";
    if (error.code === "invalid_request") return "La apuesta no es válida o la ronda ya cerró.";
    if (error.code === "network") return "No hay conexión con el servidor. Intenta de nuevo.";
    if (error.code === "unauthorized") return "Inicia sesión para continuar.";
  }
  return "Ocurrió un error inesperado. Intenta de nuevo.";
}

export function CrashPage({ config }: { config: CrashGameConfig }) {
  const { game, title, stageLabel, Stage, impactText, capText } = config;
  const api = useApi();
  const balanceText = useBalance();
  const refreshBalance = useRefreshBalance();
  const applyBalance = useApplyBalance();

  const [state, dispatch] = useReducer(crashReducer, initialCrashState);
  const { round, myBet } = state;

  const serverOffset = useRef(0);
  const serverNow = useCallback(() => Date.now() + serverOffset.current, []);

  const [loadFailed, setLoadFailed] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [history, setHistory] = useState<CrashRound[]>([]);

  const [amountText, setAmountText] = useState(DEFAULT_STAKE);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const busy = useRef(false);
  // One Idempotency-Key per distinct bet: a retry of the same round and stake reuses it.
  const pendingKey = useRef<{ signature: string; key: string } | null>(null);
  const alive = useRef(false);
  const loadedOnce = useRef(false);
  // Latest cash-out, so the keyboard shortcut always calls the current closure.
  const cashOutRef = useRef<() => void>(() => {});

  const loadHistory = useCallback(async () => {
    try {
      const response = await api.listCrashHistory(game);
      if (alive.current) setHistory(response.rounds);
    } catch {
      // The history is a nice-to-have; a failure leaves the last list untouched.
    }
  }, [api, game]);

  const sync = useCallback(async () => {
    try {
      const response = await api.getCurrentCrash(game);
      if (!alive.current) return;
      serverOffset.current = Date.parse(response.now) - Date.now();
      loadedOnce.current = true;
      setLoadFailed(false);
      dispatch({ type: "snapshot", response });
    } catch {
      if (alive.current && !loadedOnce.current) setLoadFailed(true);
    }
  }, [api, game]);

  useEffect(() => {
    alive.current = true;
    let active = true;
    let connected = false;
    void loadHistory();
    const stop = api.watchCrash(
      game,
      (event) => {
        if (active) dispatch({ type: "event", event });
      },
      (status) => {
        if (!active) return;
        if (status === "reconnecting") {
          setReconnecting(true);
          return;
        }
        connected = true;
        setReconnecting(false);
        void sync();
      },
    );
    if (!connected) void sync();
    return () => {
      active = false;
      alive.current = false;
      stop();
    };
  }, [api, game, sync, loadHistory]);

  useEffect(() => {
    if (state.syncRequest > 0) void sync();
  }, [state.syncRequest, sync]);

  // The balance and the history change at settlement; refresh them once per observed settlement.
  const roundId = round?.id ?? null;
  const status = round?.status ?? null;
  const seen = useRef<{ id: string; status: string } | null>(null);
  useEffect(() => {
    if (roundId === null || status === null) return;
    const previous = seen.current;
    seen.current = { id: roundId, status };
    if (status === "settled" && previous?.id === roundId && previous.status !== "settled") {
      void refreshBalance();
      void loadHistory();
    }
  }, [roundId, status, refreshBalance, loadHistory]);

  // A new round clears the form error (the stake is kept for convenience).
  const [formRoundId, setFormRoundId] = useState<string | null>(null);
  if (roundId !== formRoundId) {
    setFormRoundId(roundId);
    setFieldError(null);
    setError(null);
  }

  const result = round?.result ?? null;
  const frozenHundredths = result?.crashHundredths ?? null;
  const flying = status === "closed";
  const hundredths = useLiveMultiplier({
    startedAtMs: state.startedAtMs,
    now: serverNow,
    frozenHundredths,
    flying,
  });

  const limits = state.limits;
  const bettingOpen =
    status === "open" &&
    round !== null &&
    limits !== null &&
    serverNow() < Date.parse(round.closesAt);
  const canCashOut = status === "closed" && myBet?.status === "pending";
  // The round left the betting window (flying or finished), regardless of whether we bet.
  const airborne = round !== null && status !== null && status !== "open";

  let phase: CrashStageProps["phase"] = "waiting";
  if (status === "closed") phase = "flying";
  else if ((status === "resolved" || status === "settled") && result) {
    phase = result.outcome === "cap" ? "cap" : "impact";
  }
  const tone =
    phase === "flying"
      ? "flying"
      : phase === "impact"
        ? "impact"
        : phase === "cap"
          ? "cap"
          : "idle";

  async function placeBet(event: FormEvent) {
    event.preventDefault();
    if (busy.current || !round || !bettingOpen || myBet) return;
    const stake = stakeMinorFromCredits(amountText);
    const bounds = limits ? limitsInCredits(limits) : null;
    if (stake === null || !bounds) {
      setError(null);
      setFieldError(
        bounds
          ? `Ingresa un número entero de créditos entre ${bounds.min} y ${bounds.max}.`
          : "Aún no se conocen los límites de la apuesta.",
      );
      return;
    }
    setFieldError(null);
    setError(null);

    const request = { roundId: round.id, stake };
    const signature = JSON.stringify(request);
    if (pendingKey.current?.signature !== signature) {
      pendingKey.current = { signature, key: newUuid() };
    }
    const { key } = pendingKey.current;

    busy.current = true;
    setSubmitting(true);
    try {
      const response = await api.placeCrashBet(game, request, key);
      pendingKey.current = null;
      if (!alive.current) return;
      applyBalance(response.balance);
      dispatch({
        type: "bet",
        roundId: response.roundId,
        bet: {
          betId: response.betId,
          stake: response.stake,
          status: "pending",
          cashoutHundredths: null,
          payout: null,
        },
      });
    } catch (caught) {
      if (!(caught instanceof ApiError && caught.code === "network")) pendingKey.current = null;
      if (!alive.current) return;
      setError(betError(caught));
      if (caught instanceof ApiError && caught.code === "conflict") void sync();
    } finally {
      busy.current = false;
      if (alive.current) setSubmitting(false);
    }
  }

  async function cashOut() {
    if (busy.current || !myBet || myBet.status !== "pending") return;
    busy.current = true;
    setSubmitting(true);
    try {
      const response = await api.cashOutCrash(game, myBet.betId);
      if (!alive.current) return;
      applyBalance(response.balance);
      dispatch({
        type: "cashout",
        betId: response.betId,
        cashoutHundredths: response.cashoutHundredths,
        payout: response.payout,
      });
    } catch (caught) {
      if (!alive.current) return;
      setError(
        caught instanceof ApiError && caught.code === "invalid_request"
          ? "No se pudo retirar: la ronda ya cayó."
          : betError(caught),
      );
      void sync();
    } finally {
      busy.current = false;
      if (alive.current) setSubmitting(false);
    }
  }

  // Keep the ref pointing at the current cash-out closure.
  useEffect(() => {
    cashOutRef.current = () => void cashOut();
  });

  // Enter or Space cash out, but only while flying with a pending bet, never from a form field, and
  // never twice from a held key (event.repeat); `cashOut` itself blocks re-entry while in flight.
  useEffect(() => {
    if (!canCashOut) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (event.key !== "Enter" && event.key !== " " && event.code !== "Space") return;
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      event.preventDefault();
      cashOutRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canCashOut]);

  const livePayout =
    myBet && myBet.status === "pending"
      ? creditsFromMinor(crashPayout(parseAmount(myBet.stake), hundredths))
      : null;

  let phaseMessage: string | null = null;
  if (!state.loaded) phaseMessage = loadFailed ? "No se pudo cargar el juego." : "Cargando…";
  else if (!round) phaseMessage = "Esperando la siguiente ronda…";
  else if (phase === "waiting") phaseMessage = "Apuestas abiertas.";
  else if (phase === "flying") phaseMessage = "¡En vuelo!";

  const outcomeMessage =
    phase === "impact" && result
      ? impactText(formatMultiplier(result.crashHundredths))
      : phase === "cap"
        ? capText
        : null;

  return (
    <div className="crash">
      <Link to="/games/mini" className="back-link">
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M10 3L5 8l5 5" />
        </svg>
        Minijuegos
      </Link>

      <header className="crash-head">
        <h1>{title}</h1>
        <span className="crash-pill-live">Crash · en vivo</span>
        <span className="crash-sticker">Hasta 20,00x</span>
        <p className="crash-balance">
          Saldo:{" "}
          <strong className="amount" data-loading={balanceText === BALANCE_LOADING || undefined}>
            {balanceText}
          </strong>{" "}
          créditos
        </p>
        <p className="crash-connection" role="status">
          {reconnecting ? "Reconectando…" : ""}
        </p>
      </header>

      <div className="crash-main">
        <section className="crash-stage" aria-label={stageLabel}>
          <div className="crash-status" role="status" aria-live="polite">
            {phaseMessage && <p className="crash-phase">{phaseMessage}</p>}
            {outcomeMessage && <p className="crash-outcome">{outcomeMessage}</p>}
          </div>
          <Multiplier hundredths={hundredths} tone={tone} />
          <Stage phase={phase} hundredths={hundredths} />
          {!state.loaded && loadFailed && (
            <button type="button" className="button button-secondary" onClick={() => void sync()}>
              Reintentar
            </button>
          )}
          <CrashHistory rounds={history} />
        </section>

        <aside className="crash-side" aria-label="Tu apuesta">
          <p className="crash-howto">{HOW_TO}</p>

          {/* Puede apostar: cuenta regresiva y formulario. */}
          {bettingOpen && !myBet && (
            <>
              <p className="crash-panel-msg">
                Apuestas abiertas · despega en{" "}
                <Countdown
                  key={round?.id}
                  deadlineMs={Date.parse(round?.closesAt ?? "")}
                  now={serverNow}
                />{" "}
                s
              </p>
              <BetPanel
                amountText={amountText}
                submitting={submitting}
                locked={false}
                fieldError={fieldError}
                error={error}
                onAmountChange={(text) => {
                  setAmountText(text);
                  setFieldError(null);
                }}
                onSubmit={placeBet}
              />
            </>
          )}

          {/* Ronda en vuelo o terminada sin apuesta propia. */}
          {airborne && !myBet && (
            <p className="crash-wait-box">Esta ronda ya despegó. Espera la próxima para apostar.</p>
          )}

          {/* Apostó y espera el despegue. */}
          {myBet && status === "open" && round && (
            <p className="crash-bet-summary">
              Apuesta lista: {creditsFromAmount(myBet.stake)} créditos · despega en{" "}
              <Countdown key={round.id} deadlineMs={Date.parse(round.closesAt)} now={serverNow} /> s
            </p>
          )}

          {/* En vuelo con apuesta: el botón de retiro, grande y con el monto en vivo. */}
          {canCashOut && livePayout && (
            <div className="crash-cashout-wrap">
              <button
                type="button"
                className="button button-large crash-cashout"
                onClick={cashOut}
                disabled={submitting}
              >
                Retirar {livePayout} créditos
              </button>
              <p className="crash-cashout-hint">o pulsa Enter / Espacio</p>
            </div>
          )}

          {myBet?.status === "settled" && myBet.cashoutHundredths !== null && (
            <div className="crash-result crash-result-win">
              <span className="crash-sticker-win">¡Retiraste!</span>
              <p>
                Ganaste {myBet.payout ? creditsFromAmount(myBet.payout) : "0"} créditos con{" "}
                {formatMultiplier(myBet.cashoutHundredths)}.
              </p>
            </div>
          )}

          {myBet?.status === "settled" && myBet.cashoutHundredths === null && (
            <div className="crash-result crash-result-loss">
              <span className="crash-sticker-loss">¡Te alcanzó!</span>
              <p>
                Perdiste tu apuesta de {creditsFromAmount(myBet.stake)} créditos
                {result ? ` en ${formatMultiplier(result.crashHundredths)}` : ""}.
              </p>
            </div>
          )}

          {error && !bettingOpen && (
            <p className="crash-error" role="alert">
              {error}
            </p>
          )}

          {round && (
            <CrashFairness serverSeedHash={round.serverSeedHash} serverSeed={round.serverSeed} />
          )}
        </aside>
      </div>
    </div>
  );
}
