import { cleanup, render, screen } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "./App";
import { createMockApiClient } from "./api";
import { routes } from "./app/routes";

afterEach(cleanup);

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<App client={createMockApiClient()} router={router} />);
}

describe("App", () => {
  it("shows the brand and the lobby with the game catalog", async () => {
    renderAt("/");
    expect(screen.getByRole("link", { name: "casino cloud" })).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Lobby" })).toBeTruthy();
    const roulette = screen.getByRole("link", { name: /Roulette/ });
    expect(roulette.getAttribute("href")).toBe("/games/roulette");
    expect(screen.getAllByText("Coming soon")).toHaveLength(3);
  });

  it("shows the balance returned by the API", async () => {
    renderAt("/");
    expect(await screen.findByText("1,000.00")).toBeTruthy();
  });

  it("routes to the wallet page", async () => {
    renderAt("/wallet");
    expect(await screen.findByRole("heading", { name: "Wallet" })).toBeTruthy();
  });

  it("shows a not found page for unknown paths", async () => {
    renderAt("/nowhere");
    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeTruthy();
  });
});
