import { cleanup, render, screen, within } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../App";
import { createMockApiClient } from "../api";
import { routes } from "../app/routes";
import { games } from "./LobbyPage";

afterEach(cleanup);

function renderLobby() {
  const router = createMemoryRouter(routes, { initialEntries: ["/"] });
  render(<App client={createMockApiClient()} router={router} />);
}

describe("LobbyPage", () => {
  it("greets with the hero heading", () => {
    renderLobby();
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toBe("What are we playing today?");
  });

  it("shows one item per game", () => {
    renderLobby();
    const list = screen.getByRole("list", { name: "Games" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(games.length);
    for (const game of games) {
      expect(within(list).getByRole("heading", { name: game.title })).toBeTruthy();
    }
  });

  it("links only the live games and marks the rest as coming soon", () => {
    renderLobby();
    const list = screen.getByRole("list", { name: "Games" });
    const links = within(list).getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute("href")).toBe("/games/roulette");
    expect(within(links[0] as HTMLElement).getByText("Play!")).toBeTruthy();
    expect(within(list).getAllByText("Soon!")).toHaveLength(3);
  });

  it("shows today's pick with the Roulette link and the balance", async () => {
    renderLobby();
    const pick = screen.getByRole("region", { name: "Spin the wheel" });
    expect(within(pick).getByRole("link", { name: "Play Roulette" }).getAttribute("href")).toBe(
      "/games/roulette",
    );
    expect(within(pick).getByText("Your credits")).toBeTruthy();
    expect(await within(pick).findByText("1,000.00")).toBeTruthy();
    expect(within(pick).getByRole("link", { name: "Open wallet" }).getAttribute("href")).toBe(
      "/wallet",
    );
  });
});
