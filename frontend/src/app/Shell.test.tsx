import { cleanup, render, screen, within } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../App";
import { createMockApiClient } from "../api";
import { routes } from "./routes";

afterEach(cleanup);

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<App client={createMockApiClient()} router={router} />);
}

describe("Shell", () => {
  it("links the brand to the lobby", () => {
    renderAt("/wallet");
    expect(screen.getByRole("link", { name: "casino cloud" }).getAttribute("href")).toBe("/");
  });

  it("marks the current page in the main navigation", () => {
    renderAt("/wallet");
    const nav = screen.getByRole("navigation", { name: "Principal" });
    const lobby = nav.querySelector('a[href="/"]');
    const wallet = nav.querySelector('a[href="/wallet"]');
    expect(wallet?.getAttribute("aria-current")).toBe("page");
    expect(lobby?.getAttribute("aria-current")).toBeNull();
  });

  it("shows the balance, the log in action and the footer notice", async () => {
    renderAt("/");
    const header = screen.getByRole("banner");
    expect(await within(header).findByText("1,000.00")).toBeTruthy();
    expect(within(header).getByText("créditos")).toBeTruthy();
    expect(within(header).getByRole("link", { name: "Iniciar sesión" }).getAttribute("href")).toBe(
      "/login",
    );
    expect(screen.getByText("Solo créditos ficticios. No hay dinero real en juego.")).toBeTruthy();
  });
});
