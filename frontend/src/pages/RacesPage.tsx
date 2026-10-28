import {
  type FocusEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { ApiError, useApi } from "../api";
import { newUuid } from "../api/uuid";
import { BALANCE_LOADING, useApplyBalance, useBalance, useRefreshBalance } from "../app/useBalance";
import { animalName } from "./races/animals";
import { BetPanel } from "./races/BetPanel";
import { Countdown } from "./races/Countdown";
import { RaceFairness } from "./races/RaceFairness";
import { RaceOutcome } from "./races/RaceOutcome";
import { RaceTrack } from "./races/RaceTrack";
import { initialRaceState, raceReducer } from "./races/raceState";
import { creditsText, limitsInCredits, stakeFromCredits } from "./races/stake";
import { useRaceWatchdog } from "./races/useRaceWatchdog";

/** Stake suggested in a fresh form, in credits. */
const DEFAULT_STAKE = "10";

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "insufficient_funds") return "Saldo insuficiente.";
    if (error.code === "conflict") return "Ya apostó en esta carrera.";
    if (error.code === "invalid_request") return "La apuesta no es válida o la ronda ya cerró.";
    if (error.code === "network") return "No hay conexión con el servidor. Intente de nuevo.";
    if (error.code === "unauthorized") return "Inicie sesión para continuar.";
  }
  return "Ocurrió un error inesperado. Intente de nuevo.";
}

/**
 * Animal races. The server runs the rounds and decides the arrival order and every amount; the
 * page follows them through `GET /races/current` and the live stream, animates the order it is
 * given and shows the amounts the API returns (README §2.5, §4.3).
 */
export function RacesPage() {
  const api = useApi();
  const balanceText = useBalance();
  const refreshBalance = useRefreshBalance();
  const applyBalance = useApplyBalance();

  const [race, dispatch] = useReducer(raceReducer, initialRaceState);
  const { round, myBet } = race;

  // Server clock minus browser clock, from the last `now` the API sent.
  const serverOffset = useRef(0);
  const serverNow = useCallback(() => Date.now() + serverOffset.current, []);

  const [loadFailed, setLoadFailed] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [finishedRoundId, setFinishedRoundId] = useState<string | null>(null);
  const [expiredRoundId, setExpiredRoundId] = useState<string | null>(null);

  const [selected, setSelected] = useState<number | null>(null);
  const [amountText, setAmountText] = useState(DEFAULT_STAKE);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  // One Idempotency-Key per distinct bet: retrying the same round, animal and stake after a
  // network failure reuses it, so the server charges once.
  const pendingKey = useRef<{ signature: string; key: string } | null>(null);

  const alive = useRef(false);
  const loadedOnce = useRef(false);

  /**
   * Fetches the current race and applies the answer. Answers need no ordering: the reducer never
   * moves a round back, so a late older snapshot cannot undo a newer one. A failure shows the
   * error only while nothing has loaded; later it leaves the current view untouched.
   */
  const sync = useCallback(async () => {
    try {
      const response = await api.getCurrentRace();
      if (!alive.current) return;
      serverOffset.current = Date.parse(response.now) - Date.now();
      loadedOnce.current = true;
      setLoadFailed(false);
      dispatch({ type: "snapshot", response, nowMs: serverNow() });
    } catch {
      if (alive.current && !loadedOnce.current) setLoadFailed(true);
    }
  }, [api, serverNow]);

  // Follow the stream. Every "connected", the first included, fetches the current race: events
  // from before the subscription started (or while disconnected) are only recoverable that way.
  // The stream may take a while to connect (or never do), so when it did not connect
  // synchronously the page also fetches right away. Cleanup covers StrictMode's double mount.
  useEffect(() => {
    alive.current = true;
    let active = true;
    let connected = false;
    const stop = api.watchRaces(
      (event) => {
        if (active) dispatch({ type: "event", event, nowMs: serverNow() });
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
  }, [api, sync, serverNow]);

  // Events can be lost: ask the server when a phase overstays its expected end (README §6).
  useRaceWatchdog({
    round,
    raceDurationMs: race.raceDurationMs,
    startedAtMs: race.startedAtMs,
    now: serverNow,
    refresh: sync,
    enabled: race.loaded,
  });

  // The reducer asks for a fetch when an event shows the page missed something.
  useEffect(() => {
    if (race.syncRequest > 0) void sync();
  }, [race.syncRequest, sync]);

  // The balance changes when a round is settled; fetch it once per observed settlement.
  const roundId = round?.id ?? null;
  const status = round?.status ?? null;
  const seenStatus = useRef<{ id: string; status: string } | null>(null);
  useEffect(() => {
    if (roundId === null || status === null) return;
    const previous = seenStatus.current;
    seenStatus.current = { id: roundId, status };
    if (status === "settled" && previous?.id === roundId && previous.status !== "settled") {
      void refreshBalance();
    }
  }, [roundId, status, refreshBalance]);

  // A new round starts with a clean form (the stake is kept for convenience).
  const [formRoundId, setFormRoundId] = useState<string | null>(null);
  if (roundId !== formRoundId) {
    setFormRoundId(roundId);
    setSelected(null);
    setFieldError(null);
    setError(null);
  }

  const winner = round?.result?.winner ?? null;
  const outcomeVisible = winner !== null && (status === "settled" || finishedRoundId === roundId);
  const limits = race.limits;
  const bettingOpen = status === "open" && expiredRoundId !== roundId && limits !== null;
  const formShown = status === "open";
  const nextRoundNotice = round !== null && (status !== "open" || myBet !== null);

  async function placeBet(event: FormEvent) {
    event.preventDefault();
    if (submittingRef.current || !round || !bettingOpen || myBet) return;
    if (selected === null) {
      setError(null);
      setFieldError("Elija un animal antes de apostar.");
      return;
    }
    const stake = stakeFromCredits(amountText, limits);
    if (stake === null) {
      setError(null);
      setFieldError(
        limits
          ? `Ingrese un número entero de créditos entre ${limitsInCredits(limits).min} y ${limitsInCredits(limits).max}.`
          : "Aún no se conocen los límites de la apuesta.",
      );
      return;
    }
    setFieldError(null);
    setError(null);

    const request = { roundId: round.id, animal: selected, stake };
    const signature = JSON.stringify(request);
    if (pendingKey.current?.signature !== signature) {
      pendingKey.current = { signature, key: newUuid() };
    }
    const { key } = pendingKey.current;

    submittingRef.current = true;
    setSubmitting(true);
    try {
      const response = await api.placeRaceBet(request, key);
      pendingKey.current = null;
      if (!alive.current) return;
      applyBalance(response.balance);
      dispatch({
        type: "bet",
        roundId: response.roundId,
        bet: { animal: response.animal, stake: response.stake, payout: null },
      });
    } catch (caught) {
      if (!(caught instanceof ApiError && caught.code === "network")) pendingKey.current = null;
      if (!alive.current) return;
      setError(errorMessage(caught));
      // The server already holds a bet of this player (another tab): show it.
      if (caught instanceof ApiError && caught.code === "conflict") void sync();
    } finally {
      submittingRef.current = false;
      if (alive.current) setSubmitting(false);
    }
  }

  // Keep keyboard focus on the page when a phase change removes the focused control.
  const root = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const focusInside = useRef(false);
  function onBlurCapture(event: FocusEvent<HTMLDivElement>) {
    const next = event.relatedTarget as Node | null;
    if (next && !root.current?.contains(next)) {
      focusInside.current = false;
      return;
    }
    const target = event.target;
    if (!next) {
      // Focus left to nowhere: a click elsewhere if the control is still there.
      queueMicrotask(() => {
        if (target.isConnected) focusInside.current = false;
      });
    }
  }
  const phaseKey = `${roundId}|${status}|${bettingOpen}|${myBet !== null}|${outcomeVisible}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on each phase change.
  useEffect(() => {
    const active = document.activeElement;
    if (!focusInside.current || (active && active !== document.body)) return;
    statusRef.current?.focus({ preventScroll: true });
  }, [phaseKey]);

  let phaseMessage: string | null = null;
  if (!race.loaded) {
    phaseMessage = loadFailed ? "No se pudo cargar la carrera." : "Cargando la carrera…";
  } else if (!round) {
    phaseMessage = "Esperando la siguiente carrera…";
  } else if (!outcomeVisible) {
    if (status === "open") {
      phaseMessage = bettingOpen
        ? "Apuestas abiertas. Elija un animal y su monto."
        : "Cerrando las apuestas…";
    } else if (status === "closed") {
      phaseMessage = "Apuestas cerradas. La carrera comienza en unos instantes.";
    } else {
      phaseMessage = "¡La carrera está en curso!";
    }
  }

  return (
    <div
      className="races"
      ref={root}
      onFocusCapture={() => {
        focusInside.current = true;
      }}
      onBlurCapture={onBlurCapture}
    >
      <header className="races-head">
        <h1>Carreras de animales</h1>
        <p className="races-balance">
          Saldo:{" "}
          <strong className="amount" data-loading={balanceText === BALANCE_LOADING || undefined}>
            {balanceText}
          </strong>{" "}
          créditos
        </p>
        <p className="races-connection" role="status">
          {reconnecting ? "Reconectando…" : ""}
        </p>
      </header>

      <div className="races-main">
        <section className="races-stage" aria-label="Carrera">
          <div
            ref={statusRef}
            tabIndex={-1}
            className="races-status"
            role="status"
            aria-live="polite"
            aria-label="Estado de la carrera"
          >
            {phaseMessage && <p className="races-phase">{phaseMessage}</p>}
            {outcomeVisible && winner !== null && (
              <RaceOutcome winner={winner} settled={status === "settled"} myBet={myBet} />
            )}
          </div>
          {!race.loaded && loadFailed && (
            <button type="button" className="button button-secondary" onClick={() => void sync()}>
              Reintentar
            </button>
          )}
          {round && status === "open" && (
            <Countdown
              key={round.id}
              deadlineMs={Date.parse(round.closesAt)}
              now={serverNow}
              onExpire={() => setExpiredRoundId(round.id)}
            />
          )}
          <RaceTrack
            order={round?.result?.order ?? null}
            startedAtMs={race.startedAtMs}
            durationMs={race.raceDurationMs ?? 0}
            now={serverNow}
            onFinish={() => setFinishedRoundId(roundId)}
          />
        </section>

        <section className="races-side" aria-label="Su apuesta">
          {myBet && (
            <p className="races-bet-summary">
              Apuesta registrada: {animalName(myBet.animal)}, {creditsText(myBet.stake)}
            </p>
          )}
          {formShown && (
            <BetPanel
              selected={selected}
              amountText={amountText}
              locked={!bettingOpen || myBet !== null}
              submitting={submitting}
              limits={limits}
              fieldError={fieldError}
              error={error}
              onSelect={(animal) => {
                setSelected(animal);
                setFieldError(null);
              }}
              onAmountChange={(text) => {
                setAmountText(text);
                setFieldError(null);
              }}
              onSubmit={placeBet}
            />
          )}
          {nextRoundNotice && <p className="races-next">Podrá apostar en la siguiente ronda.</p>}
          {round && (
            <RaceFairness serverSeedHash={round.serverSeedHash} serverSeed={round.serverSeed} />
          )}
        </section>
      </div>
    </div>
  );
}
