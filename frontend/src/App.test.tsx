import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { App } from "./App";

afterEach(cleanup);

it("renders the Casino Cloud heading", () => {
  render(<App />);
  expect(screen.getByRole("heading", { name: "Casino Cloud" })).toBeTruthy();
});
