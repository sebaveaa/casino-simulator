/**
 * Designs for the back of the cards. The free ones can be used now; the ones with a price are
 * shown locked until a shop sells them, since a purchase must move credits through the wallet
 * (README §2.3). Each design is a `bj-back-<id>` class in the stylesheet.
 */
export type Deck = {
  id: string;
  name: string;
  /** In whole credits; null when free. */
  price: number | null;
};

export const DECKS: readonly Deck[] = [
  { id: "clasico", name: "Clásico", price: null },
  { id: "lila", name: "Lila", price: null },
  { id: "pano", name: "Paño", price: null },
  { id: "ajedrez", name: "Ajedrez", price: 150 },
  { id: "medianoche", name: "Medianoche", price: 300 },
  { id: "oro", name: "Oro", price: 500 },
];

const STORAGE_KEY = "casino.blackjack.deck";
const DEFAULT_DECK = "clasico";

const isFree = (id: string) => DECKS.some((deck) => deck.id === id && deck.price === null);

/** The design the player picked in this browser, or the classic one. */
export function loadDeck(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved && isFree(saved) ? saved : DEFAULT_DECK;
  } catch {
    return DEFAULT_DECK;
  }
}

export function saveDeck(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // A preference only: without storage it lasts until the page reloads.
  }
}
