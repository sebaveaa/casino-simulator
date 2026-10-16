// PROTOTYPE — throwaway, see branch prototype/12-roulette-table
import { formatCredits, type RouletteSelection, roulette } from "@casino/shared";
import { type CSSProperties, useState } from "react";
import { BallWheel } from "./BallWheel";
import "./prototype.css";
import "./prototype-c.css";
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
  if (whole >= 100n) return "proto-c-chip-100";
  if (whole >= 25n) return "proto-c-chip-25";
  if (whole >= 10n) return "proto-c-chip-10";
  if (whole >= 5n) return "proto-c-chip-5";
  return "proto-c-chip-1";
}

/** Rows of the 1-36 grid: top 3,6..36; middle 2,5..35; bottom 1,4..34. */
const GRID_ROWS = [3, 2, 1].map((offset) => Array.from({ length: 12 }, (_, c) => c * 3 + offset));

const DOZENS = [1, 2, 3] as const;

function Banner({ round }: { round: Round }) {
  const payout = useCountUp(round.payout, true);
  const color = pocketColor(round.number);
  return (
    <div className="proto-c-banner" data-won={round.payout > 0n || undefined}>
      <p className="proto-c-banner-main">
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
      <p className={cx("proto-c-banner-net", round.net >= 0n ? "wallet-ok" : "wallet-error")}>
        Neto: <strong className="amount">{signedCredits(round.net)}</strong> créditos
      </p>
    </div>
  );
}

export function VariantC() {
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
        className={cx("proto-c-cell", className, highlighted && "is-win")}
        style={style}
        data-tip={tip}
        aria-label={`${selectionLabel(selection)}. ${tip}`}
        disabled={spinning}
        onClick={() => place(selection)}
      >
        <span className="proto-c-cell-label">{label}</span>
        {placed !== undefined && (
          <span
            key={placed.toString()}
            className={cx(
              "proto-c-chip proto-c-chip-on-cell",
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
    <div className="proto-c">
      <header className="proto-c-head">
        <h1>Ruleta</h1>
        <p>
          Saldo: <strong className="amount">{formatCredits(balance)}</strong> créditos{" "}
          <button type="button" className="proto-link" onClick={table.resetBalance}>
            Reiniciar saldo (prototipo)
          </button>
        </p>
      </header>

      <div className="proto-c-main">
        <aside className="proto-c-left" aria-label="Rueda y resumen">
          <BallWheel target={table.target} spinId={table.spinId} onSpinEnd={table.onSpinEnd} />
          <ol className="proto-c-history" aria-label="Últimos resultados">
            {table.history.length === 0 && <li className="proto-c-history-empty">Sin giros aún</li>}
            {table.history.map((entry, i) => (
              <li
                key={entry.id}
                className={cx(
                  "proto-c-dot",
                  `pocket-${pocketColor(entry.number)}`,
                  i === 0 && "is-latest",
                )}
                title={`Salió el ${entry.number}`}
              >
                {entry.number}
              </li>
            ))}
          </ol>
          <div aria-live="polite" role="status" className="proto-c-status">
            {spinning && <p className="proto-c-spinning">Girando…</p>}
            {round && !spinning && <Banner key={round.id} round={round} />}
            {!round && !spinning && (
              <p className="proto-c-hint">Elija una ficha y pulse sobre la mesa para apostar.</p>
            )}
          </div>

          <dl className="proto-c-summary" aria-label="Resumen de la apuesta">
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
            <p className="wallet-error proto-c-alert" role="alert">
              La apuesta total supera su saldo.
            </p>
          )}
        </aside>

        <section className="proto-c-right" aria-label="Mesa">
          <div className="proto-c-scroll">
            <div className="proto-c-felt">
              {cell({ type: "straight", number: 0 }, "0", "proto-c-zero", {
                gridColumn: 1,
                gridRow: "1 / span 3",
              })}
              {GRID_ROWS.map((row, r) =>
                row.map((n) =>
                  cell(
                    { type: "straight", number: n },
                    String(n),
                    `proto-c-num proto-c-${pocketColor(n)}`,
                    { gridColumn: Math.ceil(n / 3) + 1, gridRow: r + 1 },
                  ),
                ),
              )}
              {DOZENS.map((d) =>
                cell({ type: "dozen", dozen: d }, `${d}ª docena`, "proto-c-outside", {
                  gridColumn: `${(d - 1) * 4 + 2} / span 4`,
                  gridRow: 4,
                }),
              )}
              {cell({ type: "parity", parity: "even" }, "Par", "proto-c-outside", {
                gridColumn: "2 / span 3",
                gridRow: 5,
              })}
              {cell(
                { type: "color", color: "red" },
                "Rojo",
                "proto-c-outside proto-c-diamond-red",
                { gridColumn: "5 / span 3", gridRow: 5 },
              )}
              {cell(
                { type: "color", color: "black" },
                "Negro",
                "proto-c-outside proto-c-diamond-black",
                { gridColumn: "8 / span 3", gridRow: 5 },
              )}
              {cell({ type: "parity", parity: "odd" }, "Impar", "proto-c-outside", {
                gridColumn: "11 / span 3",
                gridRow: 5,
              })}
            </div>
          </div>

          <div className="proto-c-rack">
            {CHIP_VALUES.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={chip === value}
                aria-label={`Ficha de ${value} créditos`}
                className={cx("proto-c-chip proto-c-rack-chip", chipTier(credits(value)))}
                onClick={() => setChip(value)}
              >
                {value}
              </button>
            ))}
          </div>

          <div className="proto-c-controls">
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
              className="button proto-c-spin"
              disabled={!canSpin}
              onClick={() => table.spin(activeBets)}
            >
              {spinning ? "Girando…" : "Girar"}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
