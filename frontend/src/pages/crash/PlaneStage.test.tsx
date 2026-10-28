import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PlaneStage } from "./PlaneStage";

afterEach(cleanup);

describe("PlaneStage", () => {
  it("renders the plane scene for each phase", () => {
    for (const phase of ["waiting", "flying", "impact", "cap"] as const) {
      const { container, unmount } = render(<PlaneStage phase={phase} hundredths={150} />);
      const scene = container.querySelector(".crash-scene-plane");
      expect(scene?.getAttribute("data-phase")).toBe(phase);
      expect(container.querySelector(".crash-plane")).toBeTruthy();
      expect(container.querySelector(".crash-plane-wing")).toBeTruthy();
      expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
      unmount();
    }
  });

  it("shows the cloud only on a cap", () => {
    const flying = render(<PlaneStage phase="flying" hundredths={150} />);
    expect(flying.container.querySelector(".crash-cloud")).toBeNull();
    cleanup();
    const cap = render(<PlaneStage phase="cap" hundredths={2000} />);
    expect(cap.container.querySelector(".crash-cloud")).toBeTruthy();
  });
});
