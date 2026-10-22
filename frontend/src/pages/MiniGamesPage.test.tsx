import { cleanup, render, screen, within } from "@testing-library/react";
import { createMemoryRouter, MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../App";
import { createMockApiClient } from "../api";
import { routes } from "../app/routes";
import { seedSession } from "../test/session";
import { MiniGameCard, miniGames } from "./MiniGamesPage";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<App client={createMockApiClient()} router={router} />);
  return router;
}

function renderHub() {
  seedSession();
  renderAt("/games/mini");
  return screen.getByRole("list", { name: "Minijuegos" });
}

describe("MiniGamesPage", () => {
  it("shows the header and a link back to the lobby", () => {
    renderHub();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Minijuegos");
    expect(screen.getByText("3 retos · una sola billetera")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Volver al inicio" }).getAttribute("href")).toBe("/");
  });

  it("lists the three mini games with their kind, description and top multiplier", () => {
    const list = renderHub();
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(miniGames.map((game) => game.title)).toEqual([
      "Cruza la Calle",
      "Dino Crash",
      "Despegue",
    ]);
    miniGames.forEach((game, index) => {
      const item = within(items[index] as HTMLElement);
      expect(item.getByRole("heading", { level: 2, name: game.title })).toBeTruthy();
      expect(item.getByText(game.kind)).toBeTruthy();
      expect(item.getByText(game.description)).toBeTruthy();
      expect(item.getByText(game.max)).toBeTruthy();
    });
  });

  it("marks every mini game as coming soon, with no play link yet", () => {
    const list = renderHub();
    expect(within(list).getAllByText("Muy pronto")).toHaveLength(3);
    expect(within(list).queryAllByRole("link")).toHaveLength(0);
  });

  it("keeps the panel art and its sticker out of the accessibility tree", () => {
    const list = renderHub();
    const panels = list.querySelectorAll(".mini-panel");
    expect(panels).toHaveLength(3);
    for (const panel of panels) {
      for (const child of panel.children) expect(child.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("sends visitors without a session to the login screen", () => {
    const router = renderAt("/games/mini");
    expect(router.state.location.pathname).toBe("/login");
    expect(screen.queryByRole("list", { name: "Minijuegos" })).toBeNull();
  });
});

describe("MiniGameCard", () => {
  it("links a playable game with a ¡Jugar! button instead of the coming-soon box", () => {
    const [game] = miniGames;
    if (!game) throw new Error("no mini games");
    render(
      <MemoryRouter>
        <MiniGameCard game={{ ...game, path: "/games/mini/chicken-road" }} />
      </MemoryRouter>,
    );
    const play = screen.getByRole("link", { name: "¡Jugar! Cruza la Calle" });
    expect(play.textContent).toBe("¡Jugar!");
    expect(play.getAttribute("href")).toBe("/games/mini/chicken-road");
    expect(screen.queryByText("Muy pronto")).toBeNull();
    expect(screen.queryByText("¡Pronto!")).toBeNull();
    expect(screen.getByRole("article").classList.contains("is-playable")).toBe(true);
  });
});
