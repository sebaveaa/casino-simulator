import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DinoStage } from "./DinoStage";

afterEach(cleanup);

describe("DinoStage", () => {
  it("renders the dinosaur scene for each phase", () => {
    for (const phase of ["waiting", "flying", "impact", "cap"] as const) {
      const { container, unmount } = render(<DinoStage phase={phase} hundredths={150} />);
      const scene = container.querySelector(".crash-scene-dino");
      expect(scene?.getAttribute("data-phase")).toBe(phase);
      expect(container.querySelector(".crash-dino")).toBeTruthy();
      // The whole scene is decorative.
      expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
      unmount();
    }
  });

  it("shows the meteor only on impact", () => {
    const flying = render(<DinoStage phase="flying" hundredths={150} />);
    expect(flying.container.querySelector(".crash-meteor")).toBeNull();
    cleanup();
    const impact = render(<DinoStage phase="impact" hundredths={150} />);
    expect(impact.container.querySelector(".crash-meteor")).toBeTruthy();
  });
});
