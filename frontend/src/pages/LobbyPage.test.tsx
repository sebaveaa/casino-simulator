import { cleanup, render, screen, within } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../App";
import { createMockApiClient } from "../api";
import { routes } from "../app/routes";
import { seedSession } from "../test/session";
import { games } from "./LobbyPage";

beforeEach(() => {
  seedSession();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function renderLobby() {
  const router = createMemoryRouter(routes, { initialEntries: ["/"] });
  render(<App client={createMockApiClient()} router={router} />);
}

describe("LobbyPage", () => {
  it("greets with the hero heading", () => {
    renderLobby();
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toBe("¿A qué jugamos hoy?");
  });

  it("shows one item per game", () => {
    renderLobby();
    const list = screen.getByRole("list", { name: "Juegos" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(games.length);
    for (const game of games) {
      expect(within(list).getByRole("heading", { name: game.title })).toBeTruthy();
    }
  });

  it("gives each game item its list index for the staggered entrance", () => {
    renderLobby();
    const items = within(screen.getByRole("list", { name: "Juegos" })).getAllByRole("listitem");
    expect(items.map((item) => item.style.getPropertyValue("--i"))).toEqual(
      games.map((_, index) => String(index)),
    );
  });

  it("links only the live games and marks the rest as coming soon", () => {
    renderLobby();
    const list = screen.getByRole("list", { name: "Juegos" });
    const links = within(list).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/games/roulette",
      "/games/races",
    ]);
    for (const link of links) expect(within(link).getByText("¡Jugar!")).toBeTruthy();
    expect(within(list).getAllByText("¡Pronto!")).toHaveLength(2);
  });

  it("shows today's pick with the Roulette link and the balance", async () => {
    renderLobby();
    const pick = screen.getByRole("region", { name: "Gira la ruleta" });
    expect(within(pick).getByRole("link", { name: "Jugar a la ruleta" }).getAttribute("href")).toBe(
      "/games/roulette",
    );
    expect(within(pick).getByText("Tus créditos")).toBeTruthy();
    expect(await within(pick).findByText("1,000.00")).toBeTruthy();
    expect(within(pick).getByRole("link", { name: "Abrir billetera" }).getAttribute("href")).toBe(
      "/wallet",
    );
  });
});
