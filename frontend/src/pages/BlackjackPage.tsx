import { parseAmount } from "@casino/shared";
import { useState } from "react";
import { Link } from "react-router";
import { useBalanceAmount } from "../app/useBalance";
import { BetPanel } from "./blackjack/BetPanel";
import { HandHistory } from "./blackjack/HandHistory";
import { PlayingPanel } from "./blackjack/PlayingPanel";
import { ResultPanel } from "./blackjack/ResultPanel";
import { Table } from "./blackjack/Table";
import { useBlackjack } from "./blackjack/useBlackjack";
import { FairnessBlock } from "./chicken-road/FairnessBlock";

/**
 * Blackjack. The server shuffles the shoe from the seed when the hand starts and plays every
 * action; the screen sends the request and shows the cards that came back (README §4.4).
 */
export function BlackjackPage() {
  const { view, history, seedPair, loading, pending, message, start, act, playAgain } =
    useBlackjack();
  const balance = useBalanceAmount();
  const [amount, setAmount] = useState("10");
  const disabled = loading || pending;

  const fairness =
    view.kind === "bet"
      ? seedPair && {
          serverSeedHash: seedPair.serverSeedHash,
          clientSeed: seedPair.clientSeed,
          nonce: seedPair.nextNonce,
        }
      : view.hand.fairness;

  return (
    <div className="blackjack">
      <Link to="/" className="back-link">
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
        Lobby
      </Link>

      <header className="cr-title-row">
        <h1>Blackjack</h1>
        <span className="cr-pill">Contra la banca</span>
        <span className="cr-top-sticker amount">Blackjack paga 3:2</span>
      </header>

      <div className="cr-content">
        <section className="cr-road-area" aria-label="Mesa">
          <Table view={view} />
          <HandHistory hands={history} />
        </section>

        <aside className="cr-panel" aria-label="Tu mano" aria-busy={disabled || undefined}>
          {view.kind === "bet" && (
            <BetPanel amount={amount} onAmount={setAmount} onStart={start} disabled={disabled} />
          )}
          {view.kind === "playing" && (
            <PlayingPanel
              hand={view.hand}
              // Unknown while the balance loads: the server still refuses a double it cannot cover.
              canAffordDouble={balance === null || balance >= parseAmount(view.hand.stake)}
              onAction={act}
              disabled={disabled}
            />
          )}
          {view.kind === "over" && (
            <ResultPanel hand={view.hand} onPlayAgain={playAgain} disabled={disabled} />
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
