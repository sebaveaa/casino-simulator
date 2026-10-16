// PROTOTYPE — throwaway, see branch prototype/12-roulette-table
import {
  formatCredits,
  MINOR_UNITS_PER_CREDIT,
  parseAmount,
  type RouletteSelection,
} from "@casino/shared";
import { type CSSProperties, useRef, useState } from "react";
import { creditsToAmount } from "../../creditsInput";
import { RouletteWheel } from "../RouletteWheel";
import "./prototype.css";
import {
  type Bet,
  bigMax,
  bigMin,
  COLOR_NAMES,
  credits,
  multiplierOf,
  netsByOutcome,
  POCKETS,
  payoutsByOutcome,
  pocketColor,
  prefersReducedMotion,
  type Round,
  selectionKey,
  selectionLabel,
  signedCredits,
  totalStake,
  useCountUp,
  useStubTable,
  WHEEL_ORDER,
} from "./useStubTable";

type Tab = "numbers" | "color" | "parity" | "dozen";
const TABS: { id: Tab; label: string }[] = [
  { id: "numbers", label: "Números" },
  { id: "color", label: "Color" },
  { id: "parity", label: "Par-Impar" },
  { id: "dozen", label: "Docenas" },
];

const QUICK_AMOUNTS = [5, 10, 25, 50];

type SlipRow = { id: number; selection: RouletteSelection; stake: bigint; leaving: boolean };

const PRESETS: { label: string; selections: RouletteSelection[] }[] = [
  {
    label: "Rojo + 3ª docena",
    selections: [
      { type: "color", color: "red" },
      { type: "dozen", dozen: 3 },
    ],
  },
  {
    label: "Vecinos del cero (0,32,15,26,3)",
    selections: [0, 32, 15, 26, 3].map((number) => ({ type: "straight", number })),
  },
  {
    label: "Par + Negro",
    selections: [
      { type: "parity", parity: "even" },
      { type: "color", color: "black" },
    ],
  },
];

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

/** Whole credits as plain text for the stake field, e.g. 1050n -> "10.5". */
function creditsText(minor: bigint): string {
  const whole = minor / MINOR_UNITS_PER_CREDIT;
  const cents = minor % MINOR_UNITS_PER_CREDIT;
  if (cents === 0n) return whole.toString();
  return `${whole}.${cents.toString().padStart(2, "0").replace(/0$/, "")}`;
}

function Reveal({ round }: { round: Round }) {
  const net = useCountUp(round.net, true, 1000);
  const color = pocketColor(round.number);
  return (
    <div className="proto-b-reveal" data-won={round.net > 0n || undefined}>
      <span className={`proto-b-reveal-number pocket-${color}`}>{round.number}</span>
      <div>
        <p className="proto-b-reveal-line">
          Salió el {round.number} ({COLOR_NAMES[color]})
        </p>
        <p className={cx("proto-b-reveal-net amount", net >= 0n ? "wallet-ok" : "wallet-error")}>
          {signedCredits(net)} créditos
        </p>
        <p className="proto-b-reveal-sub">
          Apostó {formatCredits(round.stake)} · Recibió {formatCredits(round.payout)}
        </p>
      </div>
    </div>
  );
}

export function VariantB() {
  const table = useStubTable();
  const { balance, spinning, round } = table;

  const [stakeText, setStakeText] = useState("10");
  const [tab, setTab] = useState<Tab>("numbers");
  const [rows, setRows] = useState<SlipRow[]>([]);
  const [hovered, setHovered] = useState<number | null>(null);
  const nextId = useRef(1);

  const parsed = creditsToAmount(stakeText);
  const stake = parsed === null ? null : parseAmount(parsed);

  const liveRows = rows.filter((row) => !row.leaving);
  const bets: Bet[] = liveRows.map((row) => ({ selection: row.selection, stake: row.stake }));
  const total = totalStake(bets);
  const hasBets = bets.length > 0;
  const nets = netsByOutcome(bets);
  const payouts = payoutsByOutcome(bets);
  const minReturn = hasBets ? bigMin(payouts) : 0n;
  const maxReturn = hasBets ? bigMax(payouts) : 0n;
  const winners = nets.filter((net) => net > 0n).length;
  const winPercent = ((winners / POCKETS.length) * 100).toFixed(1);
  const maxAbs = nets.reduce(
    (max, net) => (net < 0n ? (-net > max ? -net : max) : net > max ? net : max),
    1n,
  );
  const afterBet = balance - total;
  const canSpin = !spinning && hasBets && total <= balance;

  const shownMaxReturn = useCountUp(maxReturn);

  function setStake(minor: bigint) {
    setStakeText(creditsText(minor < 100n ? 100n : minor));
  }

  function add(selection: RouletteSelection, amount: bigint | null = stake) {
    if (amount === null || spinning) return;
    setRows((previous) => {
      const existing = previous.find(
        (row) => !row.leaving && selectionKey(row.selection) === selectionKey(selection),
      );
      if (existing) {
        return previous.map((row) =>
          row.id === existing.id ? { ...row, stake: row.stake + amount } : row,
        );
      }
      return [...previous, { id: nextId.current++, selection, stake: amount, leaving: false }];
    });
  }

  function restake(id: number, delta: bigint) {
    setRows((previous) =>
      previous.map((row) =>
        row.id === id
          ? { ...row, stake: row.stake + delta < 100n ? 100n : row.stake + delta }
          : row,
      ),
    );
  }

  function remove(id: number) {
    if (prefersReducedMotion()) {
      setRows((previous) => previous.filter((row) => row.id !== id));
      return;
    }
    setRows((previous) => previous.map((row) => (row.id === id ? { ...row, leaving: true } : row)));
    window.setTimeout(() => setRows((previous) => previous.filter((row) => row.id !== id)), 220);
  }

  function picker() {
    const button = (selection: RouletteSelection, label: string, className?: string) => (
      <button
        key={selectionKey(selection)}
        type="button"
        className={cx("proto-b-pick", className)}
        disabled={stake === null || spinning}
        onClick={() => add(selection)}
      >
        {label}
      </button>
    );
    switch (tab) {
      case "numbers":
        return (
          <div className="proto-b-pick-grid">
            {POCKETS.map((number) =>
              button({ type: "straight", number }, String(number), `pocket-${pocketColor(number)}`),
            )}
          </div>
        );
      case "color":
        return (
          <div className="proto-b-pick-row">
            {button({ type: "color", color: "red" }, "Rojo", "pocket-red")}
            {button({ type: "color", color: "black" }, "Negro", "pocket-black")}
          </div>
        );
      case "parity":
        return (
          <div className="proto-b-pick-row">
            {button({ type: "parity", parity: "even" }, "Par")}
            {button({ type: "parity", parity: "odd" }, "Impar")}
          </div>
        );
      case "dozen":
        return (
          <div className="proto-b-pick-row">
            {button({ type: "dozen", dozen: 1 }, "1ª docena (1-12)")}
            {button({ type: "dozen", dozen: 2 }, "2ª docena (13-24)")}
            {button({ type: "dozen", dozen: 3 }, "3ª docena (25-36)")}
          </div>
        );
    }
  }

  const focus = hovered ?? round?.number ?? null;

  return (
    <div className="proto-b">
      <header className="proto-b-head">
        <h1>Ruleta</h1>
        <p>
          Saldo: <strong className="amount">{formatCredits(balance)}</strong> créditos{" "}
          <button type="button" className="proto-link" onClick={table.resetBalance}>
            Reiniciar saldo (prototipo)
          </button>
        </p>
      </header>

      <section className="proto-b-stage" aria-label="Rueda">
        <RouletteWheel target={table.target} spinId={table.spinId} onSpinEnd={table.onSpinEnd} />
        <ol className="proto-b-ribbon" aria-label="Últimos resultados">
          {table.history.length === 0 && <li className="proto-b-ribbon-empty">Sin giros aún</li>}
          {table.history.map((entry) => (
            <li
              key={entry.id}
              className={`proto-b-ribbon-item pocket-${pocketColor(entry.number)}`}
              title={`Salió el ${entry.number}`}
            >
              {entry.number}
            </li>
          ))}
        </ol>
        <div aria-live="polite" role="status" className="proto-b-status">
          {spinning && <p className="proto-b-spinning">Girando…</p>}
          {round && !spinning && <Reveal key={round.id} round={round} />}
          {!round && !spinning && <p className="proto-b-hint">Arme su boleta y pulse Girar.</p>}
        </div>
      </section>

      <div className="proto-b-columns">
        <section className="wallet-card proto-b-builder" aria-label="Armar apuesta">
          <h2>Armar apuesta</h2>

          <div className="proto-b-stake">
            <label htmlFor="proto-b-stake">Monto por apuesta (créditos)</label>
            <div className="proto-b-stepper">
              <button
                type="button"
                aria-label="Disminuir monto"
                disabled={stake === null || spinning}
                onClick={() => stake !== null && setStake(stake - 100n)}
              >
                −
              </button>
              <input
                id="proto-b-stake"
                className="wallet-input"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={stakeText}
                onChange={(event) => setStakeText(event.target.value)}
                aria-invalid={stake === null || undefined}
              />
              <button
                type="button"
                aria-label="Aumentar monto"
                disabled={stake === null || spinning}
                onClick={() => stake !== null && setStake(stake + 100n)}
              >
                +
              </button>
            </div>
            <div className="proto-b-quick">
              {QUICK_AMOUNTS.map((amount) => (
                <button
                  key={amount}
                  type="button"
                  className="proto-b-quick-btn"
                  aria-pressed={stake === credits(amount)}
                  onClick={() => setStake(credits(amount))}
                >
                  {amount}
                </button>
              ))}
            </div>
            {stake === null && (
              <p className="wallet-error" role="alert">
                Ingrese un monto mayor que cero, con hasta dos decimales.
              </p>
            )}
          </div>

          <div className="proto-b-presets">
            <span className="proto-b-presets-title">Combinaciones rápidas</span>
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                className="proto-b-preset"
                disabled={stake === null || spinning}
                onClick={() => {
                  for (const selection of preset.selections) add(selection);
                }}
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div className="proto-b-tabs" role="tablist" aria-label="Tipo de apuesta">
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={tab === item.id}
                onClick={() => setTab(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div role="tabpanel">{picker()}</div>
        </section>

        <section className="wallet-card proto-b-slip" aria-label="Boleta">
          <h2>
            Boleta <span className="proto-b-count">{bets.length}</span>
          </h2>

          {rows.length === 0 && (
            <p className="proto-b-empty">
              La boleta está vacía. Agregue apuestas desde el selector o una combinación rápida.
            </p>
          )}
          <ul className="proto-b-rows">
            {rows.map((row) => {
              const mult = multiplierOf(row.selection);
              const settledBet =
                round?.bets.find(
                  (bet) =>
                    selectionKey(bet.selection) === selectionKey(row.selection) &&
                    bet.stake === row.stake,
                ) ?? null;
              const rowNet =
                settledBet && round ? payoutOf(settledBet, round.number) - settledBet.stake : null;
              return (
                <li key={row.id} className={cx("proto-b-row", row.leaving && "is-leaving")}>
                  <div className="proto-b-row-main">
                    <strong>{selectionLabel(row.selection)}</strong>
                    <span className="proto-b-row-meta">
                      paga x{mult.toString()} · ganarías{" "}
                      <span className="amount">+{formatCredits(row.stake * (mult - 1n))}</span>
                    </span>
                  </div>
                  <div className="proto-b-row-stake">
                    <button
                      type="button"
                      aria-label={`Disminuir ${selectionLabel(row.selection)}`}
                      disabled={spinning || row.stake <= 100n}
                      onClick={() => restake(row.id, -100n)}
                    >
                      −
                    </button>
                    <span key={row.stake.toString()} className="amount proto-b-flash">
                      {formatCredits(row.stake)}
                    </span>
                    <button
                      type="button"
                      aria-label={`Aumentar ${selectionLabel(row.selection)}`}
                      disabled={spinning}
                      onClick={() => restake(row.id, 100n)}
                    >
                      +
                    </button>
                  </div>
                  {rowNet !== null && (
                    <span
                      className={cx(
                        "proto-b-row-result amount",
                        rowNet > 0n ? "wallet-ok" : "wallet-error",
                      )}
                    >
                      {signedCredits(rowNet)}
                    </span>
                  )}
                  <button
                    type="button"
                    className="proto-b-remove"
                    aria-label={`Quitar ${selectionLabel(row.selection)}`}
                    disabled={spinning}
                    onClick={() => remove(row.id)}
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>

          <dl className="proto-b-totals">
            <div>
              <dt>Apuesta total</dt>
              <dd className="amount">{formatCredits(total)}</dd>
            </div>
            <div>
              <dt>Retorno mínimo</dt>
              <dd className="amount">{formatCredits(minReturn)}</dd>
            </div>
            <div>
              <dt>Retorno máximo</dt>
              <dd className="amount">{formatCredits(shownMaxReturn)}</dd>
            </div>
            <div>
              <dt>Saldo tras apostar</dt>
              <dd className={cx("amount", afterBet < 0n && "proto-negative")}>
                {formatCredits(afterBet)}
              </dd>
            </div>
          </dl>
          {total > balance && (
            <p className="wallet-error" role="alert">
              La apuesta total supera su saldo.
            </p>
          )}
          <div className="proto-b-slip-actions">
            <button
              type="button"
              className="button button-secondary"
              disabled={spinning || rows.length === 0}
              onClick={() => setRows([])}
            >
              Vaciar boleta
            </button>
            <button
              type="button"
              className="button proto-b-spin"
              disabled={!canSpin}
              onClick={() => table.spin(bets)}
            >
              {spinning ? "Girando…" : "Girar"}
            </button>
          </div>
        </section>
      </div>

      <section className="wallet-card proto-b-map" aria-label="Mapa de resultados">
        <h2>Mapa de resultados</h2>
        <p className="proto-b-odds">
          Probabilidad de ganar algo:{" "}
          <strong className="amount">
            {hasBets ? winners : 0}/37 ({hasBets ? winPercent : "0.0"}%)
          </strong>
        </p>
        <ol className="proto-b-strip">
          {WHEEL_ORDER.map((number) => {
            const net = hasBets ? (nets[number] ?? 0n) : 0n;
            const level = net === 0n ? 0 : Number(((net < 0n ? -net : net) * 85n) / maxAbs) + 15;
            const kind = net > 0n ? "is-win" : net < 0n ? "is-loss" : "is-even";
            return (
              <li key={number}>
                <button
                  type="button"
                  className={cx(
                    "proto-b-pocket",
                    kind,
                    level >= 60 && "is-strong",
                    round?.number === number && "is-result",
                    focus === number && "is-focus",
                  )}
                  style={{ "--k": level } as CSSProperties}
                  title={`Si sale ${number}: ${signedCredits(net)}`}
                  aria-label={`Si sale ${number}: ${signedCredits(net)} créditos`}
                  onMouseEnter={() => setHovered(number)}
                  onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered(number)}
                  onBlur={() => setHovered(null)}
                >
                  <span className={`proto-b-pocket-bar pocket-${pocketColor(number)}`} />
                  {number}
                </button>
              </li>
            );
          })}
        </ol>
        <p className="proto-b-readout" aria-live="off">
          {focus === null
            ? "Pase el cursor sobre una casilla para ver el resultado neto."
            : `Si sale ${focus}: ${signedCredits(hasBets ? (nets[focus] ?? 0n) : 0n)} créditos${
                round?.number === focus ? " (salió en el último giro)" : ""
              }`}
        </p>
        <p className="proto-b-legend">
          <span className="proto-b-swatch is-win" /> gana{" "}
          <span className="proto-b-swatch is-loss" /> pierde · el tono indica la magnitud
        </p>
      </section>
    </div>
  );
}

function payoutOf(bet: Bet, number: number): bigint {
  return payoutsByOutcome([bet])[number] ?? 0n;
}
