import { Link } from "react-router";
import { MiniGameArt, type MiniGameId } from "./mini-games/MiniGameArt";

/** Background of a card's illustration panel; each maps to a `.tone-*` class. */
type PanelTone = "sun" | "tomato" | "ink";

export interface MiniGameEntry {
  id: MiniGameId;
  title: string;
  /** Pill above the title: how the game is played. */
  kind: string;
  description: string;
  /** Highest multiplier, as shown in the card's footer. */
  max: string;
  tone: PanelTone;
  /** Route of the game; absent while it is not playable. */
  path?: string;
}

/** Mini games listed on the hub. Cruza la Calle is playable; the two Crash games come later. */
export const miniGames: MiniGameEntry[] = [
  {
    id: "chicken-road",
    title: "Cruza la Calle",
    kind: "Por pasos · individual",
    description:
      "Avanza carril por carril. Cada paso sube el premio; si te atropellan, lo pierdes.",
    max: "Hasta 3,66x",
    tone: "sun",
    path: "/games/mini/chicken-road",
  },
  {
    id: "dino-crash",
    title: "Dino Crash",
    kind: "Crash · en vivo",
    description:
      "El multiplicador sube mientras el dino corre. Retírate antes de que caiga el meteorito.",
    max: "Hasta 20,00x",
    tone: "tomato",
    path: "/games/mini/dino-crash",
  },
  {
    id: "aviator",
    title: "Despegue",
    kind: "Crash · en vivo",
    description: "El avión sube y tu premio también. Cobra antes de que se pierda entre las nubes.",
    max: "Hasta 20,00x",
    tone: "ink",
    path: "/games/mini/aviator",
  },
];

/** One mini game: illustrated panel, then kind, title, description, top multiplier and action. */
export function MiniGameCard({ game }: { game: MiniGameEntry }) {
  const playable = game.path !== undefined;
  return (
    <article className={playable ? "mini-card is-playable" : "mini-card"}>
      <div className={`mini-panel tone-${game.tone}`}>
        <MiniGameArt id={game.id} />
        {!playable && (
          <span className="mini-panel-soon" aria-hidden="true">
            ¡Pronto!
          </span>
        )}
      </div>
      <div className="mini-body">
        <span className="mini-kind">{game.kind}</span>
        <h2 className="mini-title">{game.title}</h2>
        <p className="mini-text">{game.description}</p>
        <div className="mini-foot">
          <span className="mini-max">{game.max}</span>
          {game.path ? (
            <Link
              to={game.path}
              className="button button-large"
              aria-label={`¡Jugar! ${game.title}`}
            >
              ¡Jugar!
            </Link>
          ) : (
            <span className="mini-soon">Muy pronto</span>
          )}
        </div>
      </div>
    </article>
  );
}

/** Mini games hub: back link, header and one card per mini game. */
export function MiniGamesPage() {
  return (
    <div className="mini-games">
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
        Volver al inicio
      </Link>

      <section className="hero">
        <span className="hero-sticker">3 retos · una sola billetera</span>
        <h1>
          <span className="underline">Minijuegos</span>
        </h1>
        <p className="hero-text">
          Apuesta, mira cómo sube tu premio y retírate a tiempo. Cada resultado lo decide el
          servidor y puedes verificarlo.
        </p>
      </section>

      <ul className="mini-list" aria-label="Minijuegos">
        {miniGames.map((game) => (
          <li key={game.id}>
            <MiniGameCard game={game} />
          </li>
        ))}
      </ul>
    </div>
  );
}
