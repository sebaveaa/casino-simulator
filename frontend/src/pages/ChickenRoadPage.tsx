import { useState } from "react";
import { Link } from "react-router";
import { BetPanel } from "./chicken-road/BetPanel";
import { FairnessBlock } from "./chicken-road/FairnessBlock";
import { GameHistory } from "./chicken-road/GameHistory";
import { PlayingPanel } from "./chicken-road/PlayingPanel";
import { ResultPanel } from "./chicken-road/ResultPanel";
import { Road } from "./chicken-road/Road";
import { useChickenRoad } from "./chicken-road/useChickenRoad";

/**
 * Cruza la Calle (Chicken Road). The server fixes the road when the game starts and decides every
 * step; the screen sends the request, waits, and shows what came back (README §4.5).
 */
export function ChickenRoadPage() {
  const {
    view,
    roadView,
    history,
    seedPair,
    loading,
    pending,
    message,
    start,
    step,
    cashOut,
    playAgain,
  } = useChickenRoad();
  const [amount, setAmount] = useState("10");
  const disabled = loading || pending;

  const fairness =
    view.kind === "bet"
      ? seedPair && {
          serverSeedHash: seedPair.serverSeedHash,
          clientSeed: seedPair.clientSeed,
          nonce: seedPair.nextNonce,
        }
      : view.game.fairness;

  return (
    <div className="chicken-road">
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

      <header className="cr-title-row">
        <h1>Cruza la Calle</h1>
        <span className="cr-pill">Por pasos</span>
        <span className="cr-top-sticker amount">Hasta 3,66x</span>
      </header>

      <div className="cr-content">
        <section className="cr-road-area" aria-label="Carretera">
          <Road view={roadView} />
          <GameHistory games={history} />
        </section>

        <aside className="cr-panel" aria-label="Tu partida" aria-busy={disabled || undefined}>
          {view.kind === "bet" && (
            <BetPanel amount={amount} onAmount={setAmount} onStart={start} disabled={disabled} />
          )}
          {view.kind === "playing" && (
            <PlayingPanel game={view.game} onStep={step} onCashOut={cashOut} disabled={disabled} />
          )}
          {view.kind === "over" && (
            <ResultPanel game={view.game} onPlayAgain={playAgain} disabled={disabled} />
          )}
          {message && (
            <p className="wallet-error" role="alert">
              {message}
            </p>
          )}
          <FairnessBlock fairness={fairness} />
        </aside>
      </div>
    </div>
  );
}
