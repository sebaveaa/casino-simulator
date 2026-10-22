import { cleanup, render, screen, within } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "./App";
import { createMockApiClient } from "./api";
import { routes } from "./app/routes";
import { seedSession } from "./test/session";

beforeEach(() => {
  seedSession();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<App client={createMockApiClient()} router={router} />);
}

describe("App", () => {
  it("shows the brand and the lobby with the game catalog", async () => {
    renderAt("/");
    expect(screen.getByRole("link", { name: "casino cloud" })).toBeTruthy();
    expect(await screen.findByRole("heading", { level: 1 })).toBeTruthy();
    const roulette = screen.getByRole("link", { name: /¡Jugar!.*Ruleta/ });
    expect(roulette.getAttribute("href")).toBe("/games/roulette");
    expect(screen.getAllByText("¡Pronto!")).toHaveLength(2);
  });

  it("shows the balance returned by the API", async () => {
    renderAt("/");
    const header = screen.getByRole("banner");
    const pick = screen.getByRole("region", { name: "Gira la ruleta" });
    expect(await within(header).findByText("1,000.00")).toBeTruthy();
    expect(await within(pick).findByText("1,000.00")).toBeTruthy();
  });

  it("routes to the wallet page", async () => {
    renderAt("/wallet");
    expect(await screen.findByRole("heading", { name: "Billetera" })).toBeTruthy();
  });

  it("shows a not found page for unknown paths", async () => {
    renderAt("/nowhere");
    expect(await screen.findByRole("heading", { name: "Página no encontrada" })).toBeTruthy();
  });
});
