// PROTOTYPE — throwaway, see branch prototype/12-roulette-table
import { formatCredits, type RouletteSelection, roulette } from "@casino/shared";
import { type CSSProperties, useEffect, useState } from "react";
import { BallWheel } from "./BallWheel";
import "./prototype.css";
import "./prototype-c.css";
import {
  type Bet,
  bigMax,
  COLOR_NAMES,
  credits,
  multiplierOf,
  payoutsByOutcome,
  pocketColor,
  prefersReducedMotion,
  type Round,
  selectionKey,
  selectionLabel,
  shortCredits,
  totalStake,
  useCountUp,
  useStubTable,
} from "./useStubTable";
import { isWheelThemeId, WHEEL_THEME_IDS, WHEEL_THEMES, type WheelThemeId } from "./wheelSceneBall";

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

// ---------------------------------------------------------------------------------------
// Look persistence (wheel and felt)
// ---------------------------------------------------------------------------------------

const WHEEL_KEY = "proto-c-wheel-theme";
const FELT_KEY = "proto-c-felt-theme";

type FeltTheme = "brand" | "classic";
const FELTS: { id: FeltTheme; label: string; swatch: string }[] = [
  {
    id: "brand",
    label: "Casino Cloud",
    swatch: "linear-gradient(135deg, #f1ecff 50%, #141414 50%)",
  },
  { id: "classic", label: "Clásico", swatch: "linear-gradient(135deg, #0b6b3a 50%, #d62839 50%)" },
];

function isFeltTheme(value: unknown): value is FeltTheme {
  return value === "brand" || value === "classic";
}

/** A stored value that no longer exists falls back to the default. */
function loadChoice<T extends string>(key: string, valid: (v: unknown) => v is T, fallback: T): T {
  try {
    const saved = localStorage.getItem(key);
    if (valid(saved)) return saved;
  } catch {
    // Storage can be blocked; fall back to the default look.
  }
  return fallback;
}

function saveChoice(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not persisted; the choice still applies for this visit.
  }
}

// ---------------------------------------------------------------------------------------
// Compact number formatting (every amount in this prototype is a whole number of credits)
// ---------------------------------------------------------------------------------------

function wholeCredits(minor: bigint): string {
  const abs = minor < 0n ? -minor : minor;
  const digits = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${minor < 0n ? "−" : ""}${digits}`;
}

function signedWhole(minor: bigint): string {
  if (minor === 0n) return "0";
  return `${minor > 0n ? "+" : ""}${wholeCredits(minor)}`;
}

function shortLabel(selection: RouletteSelection): string {
  switch (selection.type) {
    case "straight":
      return String(selection.number);
    case "dozen":
      return `${selection.dozen}ª doc.`;
    default:
      return selectionLabel(selection);
  }
}

// ---------------------------------------------------------------------------------------
// Inline SVG icons
// ---------------------------------------------------------------------------------------

const ICON = {
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  focusable: false,
} as const;

function ChipStackIcon() {
  return (
    <svg {...ICON} className="proto-c-icon">
      <title>Fichas</title>
      <ellipse cx="12" cy="17" rx="8" ry="3" fill="currentColor" fillOpacity="0.35" />
      <ellipse cx="12" cy="12.5" rx="8" ry="3" fill="currentColor" fillOpacity="0.55" />
      <ellipse cx="12" cy="8" rx="8" ry="3" fill="currentColor" />
      <path d="M4 8v9M20 8v9" />
    </svg>
  );
}

function TrophyIcon() {
  return (
    <svg {...ICON} className="proto-c-icon">
      <title>Trofeo</title>
      <path d="M7 4h10v5a5 5 0 0 1-10 0z" fill="currentColor" fillOpacity="0.3" />
      <path d="M7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3M12 14v4M8 20h8" />
    </svg>
  );
}

function TicketIcon() {
  return (
    <svg {...ICON} className="proto-c-icon">
      <title>Boleta</title>
      <path
        d="M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4z"
        fill="currentColor"
        fillOpacity="0.2"
      />
      <path d="M15 8v8" strokeDasharray="2 2" />
    </svg>
  );
}

function WalletIcon() {
  return (
    <svg {...ICON} className="proto-c-icon">
      <title>Billetera</title>
      <path
        d="M3 7h15a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 7l12-3v3"
        fill="currentColor"
        fillOpacity="0.2"
      />
      <circle cx="16" cy="13.5" r="1.2" fill="currentColor" />
    </svg>
  );
}

function CoinIcon() {
  return (
    <svg {...ICON} className="proto-c-icon proto-c-coin">
      <title>Créditos</title>
      <circle cx="12" cy="12" r="9" fill="#ffc933" stroke="#141414" />
      <circle cx="12" cy="12" r="5.5" stroke="#141414" strokeWidth="1.5" />
    </svg>
  );
}

// ---------------------------------------------------------------------------------------
// Payout multiplier badge ("x36"), coloured by risk
// ---------------------------------------------------------------------------------------

function MultBadge({ selection, className }: { selection: RouletteSelection; className?: string }) {
  const mult = multiplierOf(selection).toString();
  return <span className={cx("proto-c-mult", `proto-c-mult-${mult}`, className)}>x{mult}</span>;
}

// ---------------------------------------------------------------------------------------
// Result: token, then +won, then -staked, then the net; no sentence
// ---------------------------------------------------------------------------------------

type Step = 0 | 1 | 2;
const STEP_MS = 700;

function Counter({
  value,
  format,
  className,
}: {
  value: bigint;
  format: (value: bigint) => string;
  className?: string;
}) {
  const shown = useCountUp(value, true, 650);
  return <span className={cx("amount", className)}>{format(shown)}</span>;
}

function Result({ round }: { round: Round }) {
  const color = pocketColor(round.number);
  const wins = round.bets.filter((bet) => roulette.payout(bet, { number: round.number }) > 0n);
  const tag = round.net > 0n ? "¡Gana!" : round.payout > 0n ? "Parcial" : "Pierde";
  const [step, setStep] = useState<Step>(() =>
    prefersReducedMotion() ? 2 : round.payout > 0n ? 0 : 1,
  );
  useEffect(() => {
    if (step >= 2) return;
    const id = window.setTimeout(() => setStep((current) => (current + 1) as Step), STEP_MS);
    return () => window.clearTimeout(id);
  }, [step]);
  const done = step === 2;
  const netTone = round.net >= 0n ? "is-up" : "is-down";

  return (
    <div className={cx("proto-c-result", round.net > 0n ? "is-win" : "is-loss")}>
      <span className={cx("proto-c-token", `pocket-${color}`)}>{round.number}</span>
      <div className="proto-c-result-body">
        {step === 0 && (
          <div className="proto-c-result-line proto-c-step">
            <CoinIcon />
            <Counter
              value={round.payout}
              format={(v) => `+${wholeCredits(v)}`}
              className="proto-c-result-amount is-up"
            />
          </div>
        )}
        {step === 1 && (
          <div className="proto-c-result-line proto-c-step">
            {round.payout > 0n && (
              <span className="proto-c-step-small is-up amount">+{wholeCredits(round.payout)}</span>
            )}
            <Counter
              value={round.stake}
              format={(v) => `−${wholeCredits(v)}`}
              className="proto-c-result-amount is-down"
            />
          </div>
        )}
        {done && (
          <div className="proto-c-result-line proto-c-step">
            <CoinIcon />
            <span className="proto-c-eq">=</span>
            <Counter
              value={round.net}
              format={signedWhole}
              className={cx("proto-c-result-amount", netTone)}
            />
            <span className="proto-c-tag">{tag}</span>
          </div>
        )}
        <div className="proto-c-result-meta">
          {done && (
            <span className="proto-c-breakdown amount" aria-hidden="true">
              <span className="is-up">+{wholeCredits(round.payout)}</span>{" "}
              <span className="is-down">−{wholeCredits(round.stake)}</span>
            </span>
          )}
          {wins.length > 0 && (
            <ul className="proto-c-wins" aria-label="Apuestas ganadoras">
              {wins.map((bet) => (
                <li key={selectionKey(bet.selection)} className="proto-c-win-chip">
                  {shortLabel(bet.selection)}
                  <MultBadge selection={bet.selection} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {!done && (
        <button
          type="button"
          className="proto-c-result-skip"
          aria-label="Mostrar el resultado final"
          onClick={() => setStep(2)}
        />
      )}
      <span className="proto-sr-only">
        {`Salió el ${round.number}, ${COLOR_NAMES[color]}. Recibió ${wholeCredits(round.payout)} créditos, apostó ${wholeCredits(round.stake)} créditos. Resultado neto: ${signedWhole(round.net)} créditos.`}
      </span>
    </div>
  );
}

export function VariantC() {
  const table = useStubTable();
  const { balance, spinning, round } = table;
  const [chip, setChip] = useState<(typeof CHIP_VALUES)[number]>(5);
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [wheelTheme, setWheelTheme] = useState<WheelThemeId>(() =>
    loadChoice(WHEEL_KEY, isWheelThemeId, "brand"),
  );
  const [feltTheme, setFeltTheme] = useState<FeltTheme>(() =>
    loadChoice(FELT_KEY, isFeltTheme, "classic"),
  );

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

  function pickTheme(id: WheelThemeId) {
    setWheelTheme(id);
    saveChoice(WHEEL_KEY, id);
  }

  function pickFelt(id: FeltTheme) {
    setFeltTheme(id);
    saveChoice(FELT_KEY, id);
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
    return (
      <button
        key={key}
        type="button"
        className={cx("proto-c-cell", className, highlighted && "is-win")}
        style={style}
        aria-label={`${selectionLabel(selection)}. Retorno x${multiplierOf(selection)}`}
        disabled={spinning}
        onClick={() => place(selection)}
      >
        <span className="proto-c-cell-label">{label}</span>
        <MultBadge selection={selection} className="proto-c-mult-tip" />
        {placed !== undefined && (
          <>
            <MultBadge selection={selection} className="proto-c-mult-corner" />
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
          </>
        )}
      </button>
    );
  }

  return (
    <div className="proto-c" data-felt={feltTheme}>
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
          <div className="proto-c-wheel-wrap">
            <BallWheel
              target={table.target}
              spinId={table.spinId}
              onSpinEnd={table.onSpinEnd}
              theme={wheelTheme}
            />
            <fieldset className="proto-c-themes">
              <legend className="proto-sr-only">Estilo de la rueda</legend>
              {WHEEL_THEME_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  className="proto-c-theme-dot"
                  style={{ "--swatch": WHEEL_THEMES[id].swatch } as CSSProperties}
                  aria-pressed={wheelTheme === id}
                  aria-label={`Rueda ${WHEEL_THEMES[id].label}`}
                  title={WHEEL_THEMES[id].label}
                  onClick={() => pickTheme(id)}
                />
              ))}
            </fieldset>
          </div>

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
            {spinning && (
              <>
                <span className="proto-c-token proto-c-token-wait" aria-hidden="true">
                  ?
                </span>
                <span className="proto-sr-only">Girando…</span>
              </>
            )}
            {round && !spinning && <Result key={round.id} round={round} />}
            {!round && !spinning && (
              <p className="proto-c-hint">Elija una ficha y haga su apuesta.</p>
            )}
          </div>

          <ul className="proto-c-summary" aria-label="Resumen de la apuesta">
            <li title="Apuesta total">
              <span className="proto-sr-only">Apuesta total</span>
              <ChipStackIcon />
              <span className="proto-c-stat">
                <span className="proto-c-cap" aria-hidden="true">
                  Apostado
                </span>
                <span className="amount">{wholeCredits(shownTotal)}</span>
              </span>
            </li>
            <li className="is-hot" title="Ganancia máxima si acierta todo lo posible en un giro">
              <span className="proto-sr-only">
                Ganancia máxima si acierta todo lo posible en un giro
              </span>
              <TrophyIcon />
              <span className="proto-c-stat">
                <span className="proto-c-cap" aria-hidden="true">
                  hasta
                </span>
                <span className="amount">{wholeCredits(shownMax)}</span>
              </span>
            </li>
            <li title="Número de apuestas">
              <span className="proto-sr-only">Número de apuestas</span>
              <TicketIcon />
              <span className="proto-c-stat">
                <span className="proto-c-cap" aria-hidden="true">
                  Apuestas
                </span>
                <span className="amount">{activeBets.length}</span>
              </span>
            </li>
            <li className={cx(afterBetting < 0n && "is-negative")} title="Saldo tras apostar">
              <span className="proto-sr-only">Saldo tras apostar</span>
              <WalletIcon />
              <span className="proto-c-stat">
                <span className="proto-c-cap" aria-hidden="true">
                  Saldo
                </span>
                <span className="amount">{wholeCredits(afterBetting)}</span>
              </span>
            </li>
          </ul>
          {total > balance && (
            <span className="proto-sr-only" role="alert">
              La apuesta total supera su saldo.
            </span>
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
            <fieldset className="proto-c-felt-themes">
              <legend className="proto-sr-only">Estilo de la mesa</legend>
              {FELTS.map((felt) => (
                <button
                  key={felt.id}
                  type="button"
                  className="proto-c-theme-dot"
                  style={{ "--swatch": felt.swatch } as CSSProperties}
                  aria-pressed={feltTheme === felt.id}
                  aria-label={`Mesa ${felt.label}`}
                  title={felt.label}
                  onClick={() => pickFelt(felt.id)}
                />
              ))}
            </fieldset>
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
