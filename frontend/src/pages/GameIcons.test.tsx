import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GameArt } from "./GameIcons";

afterEach(cleanup);

describe("GameArt", () => {
  it("draws the mini games controller with its bolt, hidden from assistive tech", () => {
    const { container } = render(<GameArt id="mini-games" />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.querySelector(".art-bolt")).not.toBeNull();
  });

  it("draws the races flag with three wind streaks, visible at rest", () => {
    const { container } = render(<GameArt id="races" />);
    expect(container.querySelector(".art-flag")).not.toBeNull();
    const streaks = [...container.querySelectorAll(".art-wind-streak")];
    expect(streaks).toHaveLength(3);
    for (const streak of streaks) expect(streak.hasAttribute("opacity")).toBe(false);
  });

  it("shows the ace with the card back hidden at rest", () => {
    const { container } = render(<GameArt id="blackjack" />);
    expect(container.querySelector(".art-card")?.textContent).toContain("A");
    expect(container.querySelector(".art-card-back")?.getAttribute("opacity")).toBe("0");
  });
});
