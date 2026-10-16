// PROTOTYPE — throwaway, see branch prototype/12-roulette-table
import { formatCredits, type RouletteSelection, roulette } from "@casino/shared";
import { type CSSProperties, useState } from "react";
import { RouletteWheel } from "../RouletteWheel";
import "./prototype.css";
import {
  type Bet,
  bigMax,
  COLOR_NAMES,
  credits,
  payAtLabel,
  payoutsByOutcome,
  pocketColor,
  type Round,
  selectionKey,
  selectionLabel,
  shortCredits,
  signedCredits,
  totalStake,
  useCountUp,
  useStubTable,
} from "./useStubTable";

const CHIP_VALUES = [1, 5, 10, 25, 100] as const;

type Placement = { selection: RouletteSelection; amount: bigint };

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

function chipTier(amount: bigint): string {
  const whole = amount / 100n;
  if (whole >= 100n) return "proto-a-chip-100";
  if (whole >= 25n) return "proto-a-chip-25";
  if (whole >= 10n) return "proto-a-chip-10";
  if (whole >= 5n) return "proto-a-chip-5";
  return "proto-a-chip-1";
}

/** Rows of the 1-36 grid: top 3,6..36; middle 2,5..35; bottom 1,4..34. */
const GRID_ROWS = [3, 2, 1].map((offset) => Array.from({ length: 12 }, (_, c) => c * 3 + offset));

const DOZENS = [1, 2, 3] as const;

function Banner({ round }: { round: Round }) {
  const payout = useCountUp(round.payout, true);
  const color = pocketColor(round.number);
  return (
    <div className="proto-a-banner" data-won={round.payout > 0n || undefined}>
      <p className="proto-a-banner-main">
        Salió el <strong className={`pocket pocket-${color}`}>{round.number}</strong> (
        {COLOR_NAMES[color]}) —{" "}
        {round.payout > 0n ? (
          <>
            Ganaste <span className="amount">{formatCredits(payout)}</span> créditos
          </>
        ) : (
          "Sin premio"
        )}
      </p>
      <p className={round.net >= 0n ? "wallet-ok" : "wallet-error"}>
        Neto de la ronda: <strong className="amount">{signedCredits(round.net)}</strong> créditos
      </p>
    </div>
  );
}

export function VariantA() {
  const table = useStubTable();
  const { balance, spinning, round } = table;
  const [chip, setChip] = useState<(typeof CHIP_VALUES)[number]>(5);
  const [placements, setPlacements] = useState<Placement[]>([]);

  const settled = round !== null;

  // Chips stay on the felt after a spin so winners and losers can be seen,
  // but they no longer count toward the next bet.
  const totals = new Map<string, Bet>();
  for (const placement of placements) {
    const key = selectionKey(placement.selection);
    const entry = totals.get(key);
    if (entry) entry.stake += placement.amount;
    else totals.set(key, { selection: placement.selection, stake: placement.amount });
  }
  const tableBets = [...totals.values()];
  const activeBets = settled ? [] : tableBets;
  const total = totalStake(activeBets);
  const maxPayout = activeBets.length > 0 ? bigMax(payoutsByOutcome(activeBets)) : 0n;
  const afterBetting = balance - total;
  const canSpin = !spinning && !settled && total > 0n && total <= balance;

  const shownTotal = useCountUp(total);
  const shownMax = useCountUp(maxPayout);

  function edit(next: (previous: Placement[]) => Placement[]) {
    if (spinning) return;
    if (settled) {
      table.clearRound();
      setPlacements(next([]));
      return;
    }
    setPlacements(next);
  }

  function place(selection: RouletteSelection) {
    edit((previous) => [...previous, { selection, amount: credits(chip) }]);
  }

  const resultNumber = round?.number ?? null;
  const winningKeys = new Set(
    tableBets
      .filter((bet) => resultNumber !== null && roulette.payout(bet, { number: resultNumber }) > 0n)
      .map((bet) => selectionKey(bet.selection)),
  );

  function cell(
    selection: RouletteSelection,
    label: string,
    className: string,
    style: CSSProperties,
  ) {
    const key = selectionKey(selection);
    const placed = totals.get(key)?.stake;
    const highlighted =
      resultNumber !== null &&
      roulette.payout({ stake: 1n, selection }, { number: resultNumber }) > 0n;
    const tip = payAtLabel(selection);
    return (
      <button
        key={key}
        type="button"
        className={cx("proto-a-cell", className, highlighted && "is-win")}
        style={style}
        data-tip={tip}
        aria-label={`${selectionLabel(selection)}. ${tip}`}
        disabled={spinning}
        onClick={() => place(selection)}
      >
        <span className="proto-a-cell-label">{label}</span>
        {placed !== undefined && (
          <span
            key={placed.toString()}
            className={cx(
              "proto-a-chip proto-a-chip-on-cell",
              chipTier(placed),
              settled && (winningKeys.has(key) ? "is-win" : "is-lose"),
            )}
          >
            {shortCredits(placed)}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="proto-a">
      <header className="proto-a-head">
        <h1>Ruleta</h1>
        <p>
          Saldo: <strong className="amount">{formatCredits(balance)}</strong> créditos{" "}
          <button type="button" className="proto-link" onClick={table.resetBalance}>
            Reiniciar saldo (prototipo)
          </button>
        </p>
      </header>

      <div className="proto-a-main">
        <section className="wallet-card proto-a-stage" aria-label="Rueda">
          <RouletteWheel target={table.target} spinId={table.spinId} onSpinEnd={table.onSpinEnd} />
          <ol className="proto-a-history" aria-label="Últimos resultados">
            {table.history.length === 0 && <li className="proto-a-history-empty">Sin giros aún</li>}
            {table.history.map((entry) => (
              <li
                key={entry.id}
                className={`proto-a-dot pocket-${pocketColor(entry.number)}`}
                title={`Salió el ${entry.number}`}
              >
                {entry.number}
              </li>
            ))}
          </ol>
        </section>

        <section className="proto-a-play" aria-label="Mesa">
          <div aria-live="polite" role="status" className="proto-a-status">
            {spinning && <p className="proto-a-spinning">Girando…</p>}
            {round && !spinning && <Banner key={round.id} round={round} />}
            {!round && !spinning && (
              <p className="proto-a-hint">Elija una ficha y pulse sobre la mesa para apostar.</p>
            )}
          </div>

          <div className="proto-a-scroll">
            <div className="proto-a-felt">
              {cell({ type: "straight", number: 0 }, "0", "proto-a-zero", {
                gridColumn: 1,
                gridRow: "1 / span 3",
              })}
              {GRID_ROWS.map((row, r) =>
                row.map((n) =>
                  cell(
                    { type: "straight", number: n },
                    String(n),
                    `proto-a-num proto-a-${pocketColor(n)}`,
                    { gridColumn: Math.ceil(n / 3) + 1, gridRow: r + 1 },
                  ),
                ),
              )}
              {DOZENS.map((d) =>
                cell({ type: "dozen", dozen: d }, `${d}ª docena`, "proto-a-outside", {
                  gridColumn: `${(d - 1) * 4 + 2} / span 4`,
                  gridRow: 4,
                }),
              )}
              {cell({ type: "parity", parity: "even" }, "Par", "proto-a-outside", {
                gridColumn: "2 / span 3",
                gridRow: 5,
              })}
              {cell(
                { type: "color", color: "red" },
                "Rojo",
                "proto-a-outside proto-a-diamond-red",
                { gridColumn: "5 / span 3", gridRow: 5 },
              )}
              {cell(
                { type: "color", color: "black" },
                "Negro",
                "proto-a-outside proto-a-diamond-black",
                { gridColumn: "8 / span 3", gridRow: 5 },
              )}
              {cell({ type: "parity", parity: "odd" }, "Impar", "proto-a-outside", {
                gridColumn: "11 / span 3",
                gridRow: 5,
              })}
            </div>
          </div>

          <div className="proto-a-rack">
            {CHIP_VALUES.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={chip === value}
                aria-label={`Ficha de ${value} créditos`}
                className={cx("proto-a-chip proto-a-rack-chip", chipTier(credits(value)))}
                onClick={() => setChip(value)}
              >
                {value}
              </button>
            ))}
          </div>

          <div className="proto-a-controls">
            <button
              type="button"
              className="button button-secondary"
              disabled={spinning || settled || placements.length === 0}
              onClick={() => edit((previous) => previous.slice(0, -1))}
            >
              Deshacer
            </button>
            <button
              type="button"
              className="button button-secondary"
              disabled={spinning || (placements.length === 0 && !settled)}
              onClick={() => edit(() => [])}
            >
              Limpiar
            </button>
            <button
              type="button"
              className="button button-secondary"
              disabled={spinning || table.lastBets.length === 0}
              onClick={() =>
                edit(() =>
                  table.lastBets.map((bet) => ({ selection: bet.selection, amount: bet.stake })),
                )
              }
            >
              Repetir
            </button>
            <button
              type="button"
              className="button button-secondary"
              disabled={spinning || settled || placements.length === 0}
              onClick={() =>
                edit((previous) => previous.map((p) => ({ ...p, amount: p.amount * 2n })))
              }
            >
              Doblar
            </button>
            <button
              type="button"
              className="button proto-a-spin"
              disabled={!canSpin}
              onClick={() => table.spin(activeBets)}
            >
              {spinning ? "Girando…" : "Girar"}
            </button>
          </div>

          <dl className="proto-a-summary" aria-label="Resumen de la apuesta">
            <div>
              <dt>Apuesta total</dt>
              <dd className="amount">{formatCredits(shownTotal)}</dd>
            </div>
            <div>
              <dt>Ganancia máxima posible</dt>
              <dd className="amount">{formatCredits(shownMax)}</dd>
            </div>
            <div>
              <dt>Apuestas</dt>
              <dd className="amount">{activeBets.length}</dd>
            </div>
            <div>
              <dt>Saldo tras apostar</dt>
              <dd className={cx("amount", afterBetting < 0n && "proto-negative")}>
                {formatCredits(afterBetting)}
              </dd>
            </div>
          </dl>
          {total > balance && (
            <p className="wallet-error" role="alert">
              La apuesta total supera su saldo.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
