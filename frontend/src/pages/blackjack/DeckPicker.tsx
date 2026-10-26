import { useEffect, useId, useRef } from "react";
import { DECKS } from "./decks";

/** A card back in a design, small, as the picker and the Mazos button show it. */
export function MiniBack({ deck }: { deck: string }) {
  return (
    <span className={`bj-mini-back bj-back-${deck}`} aria-hidden="true">
      <span className="bj-mini-back-pattern" />
    </span>
  );
}

/** A padlock: a design that is sold, not yet the player's. */
function LockIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <rect x="2" y="5.5" width="8" height="5.5" rx="1.5" fill="currentColor" />
      <path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" />
    </svg>
  );
}

/**
 * "Mazos", over the felt: every design for the back of the cards. A free one is used at once;
 * one with a price is shaded, with a large padlock on it and its price, and cannot be picked
 * yet. Escape or Listo closes it.
 */
export function DeckPicker({
  deck,
  onPick,
  onClose,
}: {
  deck: string;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const current = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    current.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="bj-result-backdrop">
      <section role="dialog" aria-labelledby={titleId} className="bj-decks">
        <h2 id={titleId} className="bj-decks-title">
          Mazos
        </h2>
        <p className="bj-hint">Elige el reverso de tus cartas.</p>
        <ul className="bj-decks-grid">
          {DECKS.map((option) => {
            const inUse = option.id === deck;
            const locked = option.price !== null;
            return (
              <li key={option.id}>
                <button
                  ref={inUse ? current : undefined}
                  type="button"
                  className={inUse ? "bj-deck is-current" : "bj-deck"}
                  aria-pressed={inUse}
                  disabled={locked}
                  onClick={() => onPick(option.id)}
                >
                  <span className="bj-deck-art">
                    <MiniBack deck={option.id} />
                    {locked && (
                      <span className="bj-deck-lock">
                        <LockIcon />
                      </span>
                    )}
                  </span>
                  <span className="bj-deck-name">{option.name}</span>
                  <span className={locked ? "bj-deck-price amount is-locked" : "bj-deck-price"}>
                    {locked ? `${option.price} créditos` : inUse ? "En uso" : "Gratis"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className="bj-hint">Los mazos con precio llegan pronto a la tienda.</p>
        <button type="button" className="button bj-result-close" onClick={onClose}>
          Listo
        </button>
      </section>
    </div>
  );
}
