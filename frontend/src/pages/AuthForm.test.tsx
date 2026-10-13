import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { type ApiClient, ApiError, createMockApiClient } from "../api";
import { createHttpApiClient } from "../api/http";
import { routes } from "../app/routes";
import { createSessionStore } from "../session";
import { SESSION_STORAGE_KEY } from "../session/store";
import { makeSession, seedSession, TEST_USER } from "../test/session";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function renderAt(path: string | { pathname: string; state?: unknown }, client?: ApiClient) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<App client={client ?? createMockApiClient()} router={router} />);
  return router;
}

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function storedSession() {
  const raw = localStorage.getItem(SESSION_STORAGE_KEY);
  return raw === null ? null : JSON.parse(raw);
}

describe("LoginPage", () => {
  it("logs in, keeps the session and goes to the lobby", async () => {
    const client = createMockApiClient();
    await client.register({ email: "ana@casino.test", password: "password123" });
    const router = renderAt("/login", client);

    fill("Correo electrónico", "Ana@Casino.test ");
    fill("Contraseña", "password123");
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));

    expect(await screen.findByText("¿A qué jugamos", { exact: false })).toBeTruthy();
    expect(router.state.location.pathname).toBe("/");
    expect(storedSession().user.email).toBe("ana@casino.test");
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeTruthy();
  });

  it("shows invalid credentials for a wrong password and stays logged out", async () => {
    const client = createMockApiClient();
    await client.register({ email: "ana@casino.test", password: "password123" });
    renderAt("/login", client);

    fill("Correo electrónico", "ana@casino.test");
    fill("Contraseña", "wrong-password");
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));

    expect(await screen.findByText("Credenciales inválidas.")).toBeTruthy();
    expect(storedSession()).toBeNull();
    expect((screen.getByRole("button", { name: "Entrar" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("validates the fields without calling the API", () => {
    const client = createMockApiClient();
    const login = vi.spyOn(client, "login");
    renderAt("/login", client);

    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));

    expect(screen.getByText("Ingrese un correo electrónico válido.")).toBeTruthy();
    expect(screen.getByText("Ingrese su contraseña.")).toBeTruthy();
    expect(login).not.toHaveBeenCalled();
  });

  it("shows a connection message on a network failure", async () => {
    const client = createMockApiClient();
    vi.spyOn(client, "login").mockRejectedValue(new ApiError("network", "down", 0));
    renderAt("/login", client);

    fill("Correo electrónico", "ana@casino.test");
    fill("Contraseña", "password123");
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));

    expect(await screen.findByText(/No hay conexión con el servidor/)).toBeTruthy();
  });

  it("returns to the page that asked for the session", async () => {
    const client = createMockApiClient();
    await client.register({ email: "ana@casino.test", password: "password123" });
    const router = renderAt("/wallet", client);
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));

    fill("Correo electrónico", "ana@casino.test");
    fill("Contraseña", "password123");
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));

    expect(await screen.findByRole("heading", { name: "Billetera" })).toBeTruthy();
    expect(router.state.location.pathname).toBe("/wallet");
  });

  it("ignores an external redirect target", async () => {
    const client = createMockApiClient();
    await client.register({ email: "ana@casino.test", password: "password123" });
    const router = renderAt({ pathname: "/login", state: { from: "//evil.test" } }, client);

    fill("Correo electrónico", "ana@casino.test");
    fill("Contraseña", "password123");
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  });

  it("leaves the screen when a session already exists", async () => {
    seedSession();
    const router = renderAt("/login");
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  });
});

describe("RegisterPage", () => {
  it("registers, keeps the session and goes to the lobby", async () => {
    const client = createMockApiClient();
    const register = vi.spyOn(client, "register");
    const router = renderAt("/register", client);

    fill("Correo electrónico", "nuevo@casino.test");
    fill("Contraseña", "password123");
    fill("Repetir contraseña", "password123");
    fireEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));

    expect(await screen.findByRole("button", { name: "Cerrar sesión" })).toBeTruthy();
    expect(register).toHaveBeenCalledWith({ email: "nuevo@casino.test", password: "password123" });
    expect(router.state.location.pathname).toBe("/");
    expect(storedSession().user.email).toBe("nuevo@casino.test");
  });

  it("shows a message for a duplicate email", async () => {
    const client = createMockApiClient();
    await client.register({ email: "ana@casino.test", password: "password123" });
    renderAt("/register", client);

    fill("Correo electrónico", "ana@casino.test");
    fill("Contraseña", "password123");
    fill("Repetir contraseña", "password123");
    fireEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));

    expect(await screen.findByText("Ese correo electrónico ya está registrado.")).toBeTruthy();
    expect(storedSession()).toBeNull();
  });

  it("validates email, password length and confirmation without calling the API", () => {
    const client = createMockApiClient();
    const register = vi.spyOn(client, "register");
    renderAt("/register", client);

    fill("Correo electrónico", "not-an-email");
    fill("Contraseña", "short");
    fill("Repetir contraseña", "different");
    fireEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));

    expect(screen.getByText("Ingrese un correo electrónico válido.")).toBeTruthy();
    expect(screen.getByText(/La contraseña debe tener entre 8 y 72 bytes/)).toBeTruthy();
    expect(screen.getByText("Las contraseñas no coinciden.")).toBeTruthy();
    expect(register).not.toHaveBeenCalled();
  });
});

describe("session", () => {
  it("restores a stored session on load", async () => {
    seedSession();
    renderAt("/wallet");
    expect(await screen.findByRole("heading", { name: "Billetera" })).toBeTruthy();
    expect(screen.getByText(TEST_USER.email)).toBeTruthy();
  });

  it("ignores an expired stored token", async () => {
    seedSession(makeSession(-60));
    const router = renderAt("/wallet");
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(screen.queryByText(TEST_USER.email)).toBeNull();
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it("redirects a guarded route to the login screen when logged out", async () => {
    const router = renderAt("/games/roulette");
    expect(await screen.findByRole("heading", { name: "Iniciar sesión" })).toBeTruthy();
    expect(router.state.location.pathname).toBe("/login");
    expect(router.state.location.state).toEqual({ from: "/games/roulette" });
  });

  it("keeps the lobby public", () => {
    const router = renderAt("/");
    expect(router.state.location.pathname).toBe("/");
    expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
  });

  it("sends the user to the login screen when the server rejects the token", async () => {
    const session = createSessionStore();
    session.set(makeSession());
    const client = createHttpApiClient({
      baseUrl: "http://api.test",
      getToken: () => session.get()?.token ?? null,
      onUnauthorized: () => session.clear(),
      fetch: (async () =>
        new Response(JSON.stringify({ error: { code: "unauthorized", message: "expired" } }), {
          status: 401,
        })) as typeof fetch,
    });
    const router = createMemoryRouter(routes, { initialEntries: ["/wallet"] });
    render(<App client={client} router={router} session={session} />);

    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });
});
