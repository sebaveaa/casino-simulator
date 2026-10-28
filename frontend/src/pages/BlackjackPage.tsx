import { parseAmount } from "@casino/shared";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useBalanceAmount } from "../app/useBalance";
import { BetPanel } from "./blackjack/BetPanel";
import { DeckPicker } from "./blackjack/DeckPicker";
import { loadDeck, saveDeck } from "./blackjack/decks";
import { balanceCovers, type ChipValue, chipsOfStake } from "./blackjack/format";
import { HandHistory } from "./blackjack/HandHistory";
import { PlayingPanel } from "./blackjack/PlayingPanel";
import { ResultDialog } from "./blackjack/ResultDialog";
import { ResultPanel } from "./blackjack/ResultPanel";
import { Shuffle } from "./blackjack/Shuffle";
import { SoundToggle } from "./blackjack/SoundToggle";
import { Table } from "./blackjack/Table";
import { useBlackjack } from "./blackjack/useBlackjack";
import { FairnessBlock } from "./chicken-road/FairnessBlock";

/**
 * Blackjack. The server shuffles the shoe from the seed when the hand starts and plays every
 * action; the screen sends the request and shows the cards that came back (README §4.4).
 */
export function BlackjackPage() {
  const {
    view,
    deal,
    history,
    seedPair,
    loading,
    pending,
    message,
    start,
    act,
    changeBet,
    repeat,
    shoe,
    shoeShuffled,
  } = useBlackjack();
  const balance = useBalanceAmount();
  // The chips on the bet; they stay between rounds, like on a real table.
  const [chips, setChips] = useState<ChipValue[]>([10]);
  // The hand whose result pop-up the player closed with "Ver la mesa".
  const [closedHandId, setClosedHandId] = useState<string | null>(null);
  // Back at the bet form with chips the balance no longer covers (it ran out, or fell below the
  // last bet), the bet starts over from no chips. Before paint, so the old chips never flash.
  useLayoutEffect(() => {
    if (view.kind !== "bet" || balance === null) return;
    setChips((placed) => (balanceCovers(balance, placed) ? placed : []));
  }, [view.kind, balance]);
  const takeBackChip = useCallback(() => setChips((placed) => placed.slice(0, -1)), []);
  // The shoe is shuffled once the cut card is out (#66): when the player leaves that hand's result,
  // before whatever they chose next (look at the table, change the bet, or deal again).
  const [shuffling, setShuffling] = useState(false);
  const afterShuffle = useRef<(() => void) | null>(null);
  const endShuffle = useCallback(() => {
    setShuffling(false);
    shoeShuffled();
    const next = afterShuffle.current;
    afterShuffle.current = null;
    next?.();
  }, [shoeShuffled]);
  const withShuffle = (action: () => void) => {
    if (!shoe?.reshuffle) {
      action();
      return;
    }
    afterShuffle.current = action;
    setShuffling(true);
  };
  // The design on the back of the cards, kept in this browser, and whether its picker is open.
  const [deck, setDeck] = useState(loadDeck);
  const [picking, setPicking] = useState(false);
  const closeDecks = useCallback(() => setPicking(false), []);
  const disabled = loading || pending || shuffling;
  // `pending` holds through the deal, so the result pops up once the last card has landed.
  const showResult =
    view.kind === "over" && !disabled && !picking && closedHandId !== view.hand.handId;

  // Unknown while the balance loads: the server still refuses a stake it cannot cover.
  const covers = (stake: string) => balance === null || balance >= parseAmount(stake);

  /** Deals again with the round's stake, putting its chips on the bet if they changed. */
  const repeatBet = (stake: string) => {
    setChips(chipsOfStake(stake, chips));
    void repeat(stake);
  };
  // The chips on the felt: the bet being built, or the stake of the round on the table.
  const tableChips = view.kind === "bet" ? chips : chipsOfStake(view.hand.stake, chips);

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
        <SoundToggle />
      </header>

      <div className="cr-content">
        <section className="cr-road-area" aria-label="Mesa">
          <div className={`bj-felt-wrap bj-back-${deck}`}>
            <Table
              view={view}
              deal={deal}
              dealing={pending}
              chips={tableChips}
              onTakeChip={view.kind === "bet" && !disabled ? takeBackChip : undefined}
              shoe={shoe}
              deck={deck}
              onDecks={() => setPicking(true)}
              canPickDeck={!shuffling && !picking}
            />
            {shuffling && <Shuffle onDone={endShuffle} />}
            {picking && (
              <DeckPicker
                deck={deck}
                onPick={(id) => {
                  setDeck(id);
                  saveDeck(id);
                }}
                onClose={closeDecks}
              />
            )}
            {showResult && (
              <ResultDialog
                hand={view.hand}
                canRepeat={covers(view.hand.stake)}
                onRepeat={() => withShuffle(() => repeatBet(view.hand.stake))}
                onChangeBet={() => withShuffle(changeBet)}
                onClose={() => {
                  const { handId } = view.hand;
                  withShuffle(() => setClosedHandId(handId));
                }}
              />
            )}
          </div>
          <HandHistory hands={history} />
        </section>

        <aside className="cr-panel" aria-label="Tu mano" aria-busy={disabled || undefined}>
          {view.kind === "bet" && (
            <BetPanel
              chips={chips}
              onAdd={(chip) => setChips((placed) => [...placed, chip])}
              onTakeBack={takeBackChip}
              onClear={() => setChips([])}
              onStart={start}
              balance={balance}
              disabled={disabled}
            />
          )}
          {view.kind === "playing" && (
            <PlayingPanel
              hand={view.hand}
              canAffordStake={covers(view.hand.stake)}
              onAction={act}
              disabled={disabled}
            />
          )}
          {view.kind === "over" && (
            <ResultPanel
              hand={view.hand}
              canRepeat={covers(view.hand.stake)}
              onRepeat={() => withShuffle(() => repeatBet(view.hand.stake))}
              onChangeBet={() => withShuffle(changeBet)}
              disabled={disabled}
            />
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
