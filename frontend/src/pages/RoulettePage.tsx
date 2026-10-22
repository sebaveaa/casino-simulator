import {
  type RouletteBet,
  type RouletteBetResponse,
  type RouletteSelection,
  totalStake,
  validateSpin,
} from "@casino/shared";
import { useRef, useState } from "react";
import { ApiError, useApi } from "../api";
import {
  BALANCE_LOADING,
  useApplyBalance,
  useBalance,
  useBalanceAmount,
  useRefreshBalance,
} from "../app/useBalance";
import { betErrorMessage } from "./betErrorMessage";
import {
  betsFromResponse,
  type Chip,
  chipsFromBets,
  doubleChips,
  maxWin,
  placeChip,
  stacksOf,
  toRequest,
  undoChip,
} from "./roulette/betSlip";
import { ChipRack } from "./roulette/ChipRack";
import { type ChipValue, chipAmount, DEFAULT_CHIP } from "./roulette/chips";
import { FairnessDetails } from "./roulette/FairnessDetails";
import { shortCredits } from "./roulette/money";
import { HISTORY_LIMIT, type HistoryEntry, ResultHistory } from "./roulette/ResultHistory";
import { RouletteTable } from "./roulette/RouletteTable";
import { RouletteWheel } from "./roulette/RouletteWheel";
import { SpinResult } from "./roulette/SpinResult";
import { SpinSummary } from "./roulette/SpinSummary";
import { TableControls } from "./roulette/TableControls";

/** A spin the server already settled, with the bets it was made of. */
type Round = { response: RouletteBetResponse; bets: RouletteBet[] };

/** "idle": chips can be placed; "revealed": the wheel stopped and the result is on screen. */
type Phase = "idle" | "submitting" | "spinning" | "revealed";

/**
 * Roulette table. The server draws the number and settles the money; the wheel and the result
 * only show what the response already says (README §4.2).
 */
export function RoulettePage() {
  const api = useApi();
  const balanceText = useBalance();
  const balance = useBalanceAmount();
  const refreshBalance = useRefreshBalance();
  const applyBalance = useApplyBalance();

  const [chipValue, setChipValue] = useState<ChipValue>(DEFAULT_CHIP);
  const [chips, setChips] = useState<Chip[]>([]);
  const [round, setRound] = useState<Round | null>(null);
  const [lastBets, setLastBets] = useState<RouletteBet[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [spinId, setSpinId] = useState(0);

  // One Idempotency-Key per distinct request: retrying the same bets after a network failure
  // reuses it, so the server charges once.
  const pendingKey = useRef<{ signature: string; key: string } | null>(null);

  const busy = phase === "submitting" || phase === "spinning";
  // After a spin the chips stay on the felt for the result, but no longer count as a bet.
  const settled = round !== null;
  const activeBets = settled ? [] : stacksOf(chips);
  const tableBets = round ? round.bets : activeBets;

  const total = totalStake(activeBets);
  const balanceAfter = balance === null ? null : balance - total;
  const overBalance = balanceAfter !== null && balanceAfter < 0n;
  const validSlip = activeBets.length === 0 || validateSpin(activeBets);
  const canSpin = !busy && !settled && activeBets.length > 0 && validSlip && !overBalance;
  const problem = overBalance
    ? "La apuesta total supera su saldo."
    : validSlip
      ? null
      : "La apuesta no es válida.";

  /** Changes the chips; the first change after a spin starts a fresh slip. */
  function edit(next: (previous: Chip[]) => Chip[]) {
    if (busy) return;
    setError(null);
    if (round) {
      setRound(null);
      setPhase("idle");
      setChips(next([]));
    } else {
      setChips(next);
    }
  }

  function place(selection: RouletteSelection) {
    edit((previous) => placeChip(previous, selection, chipAmount(chipValue)));
  }

  async function spin() {
    if (!canSpin) return;
    setError(null);
    const request = toRequest(activeBets);
    const signature = JSON.stringify(request);
    if (pendingKey.current?.signature !== signature) {
      pendingKey.current = { signature, key: crypto.randomUUID() };
    }
    const { key } = pendingKey.current;

    setPhase("submitting");
    try {
      const response = await api.placeRouletteBet(request, key);
      pendingKey.current = null;
      const bets = betsFromResponse(response.bets);
      setRound({ response, bets });
      setLastBets(bets);
      setPhase("spinning");
      setSpinId((id) => id + 1);
    } catch (caught) {
      if (!(caught instanceof ApiError && caught.code === "network")) pendingKey.current = null;
      setError(betErrorMessage(caught));
      setPhase("idle");
    }
  }

  function onSpinEnd() {
    setPhase("revealed");
    if (round) {
      const entry = { id: round.response.betId, number: round.response.result.number };
      setHistory((previous) =>
        previous.some((item) => item.id === entry.id)
          ? previous
          : [entry, ...previous].slice(0, HISTORY_LIMIT),
      );
      // The balance changes only now, so the header does not give the result away early.
      applyBalance(round.response.balance);
    }
    void refreshBalance();
  }

  const revealed = round !== null && phase === "revealed";
  const spinLabel =
    phase === "submitting" ? "Enviando…" : phase === "spinning" ? "Girando…" : "Girar";

  return (
    <div className="roulette">
      <header className="roulette-head">
        <h1>Ruleta</h1>
        <p className="roulette-balance">
          Saldo:{" "}
          <strong className="amount" data-loading={balanceText === BALANCE_LOADING || undefined}>
            {balanceText}
          </strong>{" "}
          créditos
        </p>
      </header>

      <div className="roulette-main">
        <section className="roulette-left" aria-label="Rueda y resumen">
          <div className="roulette-wheel-wrap">
            <RouletteWheel
              target={round ? round.response.result.number : null}
              spinId={spinId}
              onSpinEnd={onSpinEnd}
            />
          </div>

          <ResultHistory entries={history} />

          <div role="status" aria-live="polite" className="roulette-status">
            {phase === "spinning" && (
              <>
                <span className="roulette-token roulette-token-wait" aria-hidden="true">
                  ?
                </span>
                <span className="roulette-sr-only">Girando…</span>
              </>
            )}
            {revealed && <SpinResult key={round.response.betId} response={round.response} />}
            {round === null && phase !== "submitting" && (
              <p className="roulette-hint">Elija una ficha y haga su apuesta.</p>
            )}
          </div>

          <SpinSummary
            staked={shortCredits(total)}
            maxWin={shortCredits(maxWin(activeBets))}
            betCount={activeBets.length}
            balanceAfter={balanceAfter === null ? balanceText : shortCredits(balanceAfter)}
            insufficient={overBalance}
          />

          {revealed && <FairnessDetails fairness={round.response.fairness} />}
        </section>

        <section className="roulette-right" aria-label="Mesa">
          <RouletteTable
            stacks={tableBets}
            outcome={revealed ? round.response.result.number : null}
            disabled={busy}
            onPlace={place}
          />
          <ChipRack selected={chipValue} onSelect={setChipValue} />
          <TableControls
            canUndo={!busy && !settled && chips.length > 0}
            canClear={!busy && (settled || chips.length > 0)}
            canRepeat={!busy && lastBets.length > 0}
            canDouble={!busy && !settled && chips.length > 0}
            canSpin={canSpin}
            spinLabel={spinLabel}
            onUndo={() => edit(undoChip)}
            onClear={() => edit(() => [])}
            onRepeat={() => edit(() => chipsFromBets(lastBets))}
            onDouble={() => edit(doubleChips)}
            onSpin={spin}
          />
          {problem && (
            <p className="roulette-problem" role="alert">
              {problem}
            </p>
          )}
          {error && (
            <p className="wallet-error" role="alert">
              {error}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
