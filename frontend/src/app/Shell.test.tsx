import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../App";
import { createMockApiClient } from "../api";
import { SESSION_STORAGE_KEY } from "../session/store";
import { seedSession, TEST_USER } from "../test/session";
import { routes } from "./routes";

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

  it("shows the balance, the user email, the log out action and the footer notice", async () => {
    renderAt("/");
    const header = screen.getByRole("banner");
    expect(await within(header).findByText("1,000.00")).toBeTruthy();
    expect(within(header).getByText("créditos")).toBeTruthy();
    expect(within(header).getByText(TEST_USER.email)).toBeTruthy();
    expect(within(header).getByRole("button", { name: "Cerrar sesión" })).toBeTruthy();
    expect(within(header).queryByRole("link", { name: "Iniciar sesión" })).toBeNull();
    expect(screen.getByText("Solo créditos ficticios. No hay dinero real en juego.")).toBeTruthy();
  });

  it("offers the log in and sign up links when logged out", () => {
    localStorage.clear();
    renderAt("/");
    const header = screen.getByRole("banner");
    expect(within(header).getByRole("link", { name: "Iniciar sesión" }).getAttribute("href")).toBe(
      "/login",
    );
    expect(within(header).getByRole("link", { name: "Crear cuenta" }).getAttribute("href")).toBe(
      "/register",
    );
    expect(within(header).queryByRole("button", { name: "Cerrar sesión" })).toBeNull();
    expect(within(header).queryByText("créditos")).toBeNull();
  });

  it("logs out: clears the stored session and returns to the lobby", async () => {
    renderAt("/wallet");
    const header = screen.getByRole("banner");
    fireEvent.click(within(header).getByRole("button", { name: "Cerrar sesión" }));
    expect(await screen.findByRole("heading", { level: 1, name: /¿A qué jugamos/ })).toBeTruthy();
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
    expect(within(header).getByRole("link", { name: "Iniciar sesión" })).toBeTruthy();
  });
});
