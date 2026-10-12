import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GameArt } from "./GameIcons";

afterEach(cleanup);

describe("GameArt", () => {
  it("starts and ends every slot reel on a 7, so a roll loops back to the resting icon", () => {
    const { container } = render(<GameArt id="slots" />);
    const reels = [...container.querySelectorAll(".art-reel")];
    expect(reels).toHaveLength(3);
    for (const reel of reels) {
      const symbols = [...reel.querySelectorAll("text")].map((text) => text.textContent);
      expect(symbols.at(0)).toBe("7");
      expect(symbols.at(-1)).toBe("7");
    }
  });

  it("shows the ace with the card back hidden at rest", () => {
    const { container } = render(<GameArt id="blackjack" />);
    expect(container.querySelector(".art-card")?.textContent).toContain("A");
    expect(container.querySelector(".art-card-back")?.getAttribute("opacity")).toBe("0");
  });
});
