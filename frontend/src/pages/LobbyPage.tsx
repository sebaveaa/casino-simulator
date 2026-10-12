import type { GameId } from "@casino/shared";
import { Link } from "react-router";
import { useBalance } from "../app/useBalance";
import { GameArt } from "./GameIcons";

/** Circle color of a game button; each maps to a `.tone-*` class. */
type Tone = "tomato" | "sun" | "chalk" | "ink";

interface GameEntry {
  id: GameId;
  title: string;
  description: string;
  tone: Tone;
  /** Route of the game; absent while it is not playable. */
  path?: string;
}

/** Games shown in the lobby. */
export const games: GameEntry[] = [
  {
    id: "roulette",
    title: "Roulette",
    description: "Bet on a number, a color or a dozen.",
    tone: "tomato",
    path: "/games/roulette",
  },
  {
    id: "races",
    title: "Animal races",
    description: "Pick a winner and cheer it on.",
    tone: "sun",
  },
  { id: "slots", title: "Slots", description: "Spin the reels.", tone: "chalk" },
  { id: "blackjack", title: "Blackjack", description: "Beat the dealer to 21.", tone: "ink" },
];

const roulette = games.find((game) => game.id === "roulette");

function GameBody({ game, live }: { game: GameEntry; live: boolean }) {
  return (
    <>
      <span className={`game-circle tone-${game.tone}`}>
        <GameArt id={game.id} />
        <span className={live ? "sticker sticker-play" : "sticker sticker-soon"}>
          {live ? "Play!" : "Soon!"}
        </span>
      </span>
      <h2 className="game-title">{game.title}</h2>
      <p className="game-text">{game.description}</p>
    </>
  );
}

/** Lobby: hero, round game buttons and today's pick. */
export function LobbyPage() {
  const balance = useBalance();

  return (
    <div className="lobby">
      <section className="hero">
        <span className="hero-sticker">Fictitious credits · zero real money</span>
        <h1>
          What are we playing <span className="underline">today?</span>
        </h1>
        <p className="hero-text">
          Everything here is played with fictitious credits. Pick a game to start.
        </p>
      </section>

      <ul className="game-list" aria-label="Games">
        {games.map((game) => (
          <li key={game.id} className="game-item">
            {game.path ? (
              <Link to={game.path} className="game-link">
                <GameBody game={game} live />
              </Link>
            ) : (
              <GameBody game={game} live={false} />
            )}
          </li>
        ))}
      </ul>

      <section className="pick" aria-labelledby="pick-title">
        <div className="pick-main">
          <span className="pick-sticker">Today's pick</span>
          <h2 id="pick-title">Spin the wheel</h2>
          <p>
            Roulette is open now. The server decides every result, and your browser can check it
            with the same code.
          </p>
          {roulette?.path && (
            <Link to={roulette.path} className="button button-large">
              Play Roulette
            </Link>
          )}
        </div>
        <div className="pick-side">
          <div className="credits-bubble">
            <span className="credits-label">Your credits</span>
            <span className="credits-amount amount">{balance}</span>
            <Link to="/wallet" className="wallet-link">
              Open wallet
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
