import { afterEach, describe, expect, it } from "vitest";
import { DECKS, loadDeck, saveDeck } from "./decks";

afterEach(() => localStorage.clear());

describe("Blackjack card backs", () => {
  it("offers free designs and some with a price", () => {
    expect(DECKS.some((deck) => deck.price === null)).toBe(true);
    expect(DECKS.some((deck) => deck.price !== null)).toBe(true);
  });

  it("keeps a free design, and falls back to the classic one for a priced or unknown one", () => {
    expect(loadDeck()).toBe("clasico");
    saveDeck("pano");
    expect(loadDeck()).toBe("pano");
    saveDeck("oro");
    expect(loadDeck()).toBe("clasico");
    saveDeck("nope");
    expect(loadDeck()).toBe("clasico");
  });
});
