import type { GameId } from "@casino/shared";
import type { CSSProperties } from "react";
import { Link } from "react-router";
import { BALANCE_LOADING, useBalance } from "../app/useBalance";
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
    title: "Ruleta",
    description: "Apuesta a un número, un color o una docena.",
    tone: "tomato",
    path: "/games/roulette",
  },
  {
    id: "races",
    title: "Carreras de animales",
    description: "Elige un ganador y anímalo hasta la meta.",
    tone: "sun",
  },
  { id: "slots", title: "Tragamonedas", description: "Haz girar los rodillos.", tone: "chalk" },
  {
    id: "blackjack",
    title: "Blackjack",
    description: "Vence a la banca sin pasarte de 21.",
    tone: "ink",
  },
];

const roulette = games.find((game) => game.id === "roulette");

function GameBody({ game, live }: { game: GameEntry; live: boolean }) {
  return (
    <>
      <span className={`game-circle tone-${game.tone}`}>
        <span className="game-art">
          <GameArt id={game.id} />
        </span>
        <span className={live ? "sticker sticker-play" : "sticker sticker-soon"}>
          {live ? "¡Jugar!" : "¡Pronto!"}
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
        <span className="hero-sticker">Créditos ficticios · cero dinero real</span>
        <h1>
          ¿A qué jugamos <span className="underline">hoy?</span>
        </h1>
        <p className="hero-text">
          Aquí todo se juega con créditos ficticios. Elige un juego para empezar.
        </p>
      </section>

      <ul className="game-list" aria-label="Juegos">
        {games.map((game, index) => (
          <li key={game.id} className="game-item" style={{ "--i": index } as CSSProperties}>
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
          <span className="pick-sticker">Destacado del día</span>
          <h2 id="pick-title">Gira la ruleta</h2>
          <p>
            La ruleta ya está abierta. El servidor decide cada resultado y tu navegador puede
            comprobarlo con el mismo código.
          </p>
          {roulette?.path && (
            <Link to={roulette.path} className="button button-large">
              Jugar a la ruleta
            </Link>
          )}
        </div>
        <div className="pick-side">
          <div className="credits-bubble">
            <span className="pick-wheel" aria-hidden="true">
              <span className="pick-wheel-turn">
                <GameArt id="roulette" />
              </span>
            </span>
            <span className="credits-label">Tus créditos</span>
            <span
              className="credits-amount amount"
              data-loading={balance === BALANCE_LOADING || undefined}
            >
              {balance}
            </span>
            <Link to="/wallet" className="wallet-link">
              Abrir billetera
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
