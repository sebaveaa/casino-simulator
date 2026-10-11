import type { GameId } from "@casino/shared";
import { Link } from "react-router";

interface GameEntry {
  id: GameId;
  title: string;
  description: string;
  /** Route of the game; absent while it is not playable. */
  path?: string;
}

/** Games shown in the lobby. */
export const games: GameEntry[] = [
  {
    id: "roulette",
    title: "Roulette",
    description: "Bet on a number, a color or a dozen and watch the wheel.",
    path: "/games/roulette",
  },
  { id: "races", title: "Animal races", description: "Pick a winner and cheer it on." },
  { id: "slots", title: "Slots", description: "Spin the reels." },
  { id: "blackjack", title: "Blackjack", description: "Beat the dealer to 21." },
];

/** Lobby: the catalog of games. */
export function LobbyPage() {
  return (
    <section>
      <h1>Lobby</h1>
      <p>Pick a game. Everything here is played with fictitious credits.</p>
      <ul className="game-grid">
        {games.map((game) => (
          <li key={game.id} className="game-card">
            <h2>{game.title}</h2>
            <p>{game.description}</p>
            {game.path ? (
              <Link to={game.path} className="button">
                Play {game.title}
              </Link>
            ) : (
              <span className="badge">Coming soon</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
