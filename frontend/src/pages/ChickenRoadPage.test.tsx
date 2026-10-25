import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { type ApiClient, ApiError, createMockApiClient } from "../api";
import { routes } from "../app/routes";
import { seedSession } from "../test/session";

const PATH = "/games/mini/chicken-road";

// Each test plays a whole game through the UI; under full-suite load that can pass 5 s.
vi.setConfig({ testTimeout: 15_000 });

/** jsdom has no `matchMedia`; without it motion is on and each step waits `REVEAL_MS`. */
function setReducedMotion(reduced: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduced && query.includes("prefers-reduced-motion"),
  }));
}

beforeEach(() => {
  seedSession();
  // Most tests look at the end state, which reduced motion shows at once.
  setReducedMotion(true);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

const conflict = () => new ApiError("conflict", "conflict", 409);

/** The mock with fixed roads (hit lane per game, `null` for none) plus overrides. */
function client(
  roads: (number | null)[] = [],
  overrides: (base: ApiClient) => Partial<ApiClient> = () => ({}),
  startingBalance?: bigint,
): ApiClient {
  const base = createMockApiClient({ chickenRoads: roads, startingBalance });
  return { ...base, ...overrides(base) };
}

const panel = () => screen.getByRole("complementary", { name: "Tu partida" });
const road = () => screen.getByRole("region", { name: "Carretera" });
const inPanel = (name: string | RegExp) => within(panel()).getByRole("button", { name });
const queryInPanel = (name: string | RegExp) => within(panel()).queryByRole("button", { name });
const alertText = () => within(panel()).queryByRole("alert")?.textContent ?? null;

/** Waits for the panel to finish loading or its request; generous, for a loaded full-suite run. */
function settled() {
  return waitFor(() => expect(panel().getAttribute("aria-busy")).toBeNull(), { timeout: 4000 });
}

async function renderPage(api: ApiClient) {
  const router = createMemoryRouter(routes, { initialEntries: [PATH] });
  render(<App client={api} router={router} />);
  await settled();
  return router;
}

/** Clicks a panel button and waits for the request to settle. */
async function press(name: string | RegExp) {
  fireEvent.click(inPanel(name));
  await settled();
}

const startGame = () => press(/^Empezar/);
const stepOnce = () => press("Siguiente paso");

/** The header chip shows the shared balance. */
const headerBalance = (text: string) => screen.findAllByText(text, {}, { timeout: 4000 });

describe("ChickenRoadPage layout and Apuesta", () => {
  it("shows the title row, the road, and the bet form with its payout table", async () => {
    const api = client();
    await renderPage(api);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Cruza la Calle");
    expect(screen.getByText("Por pasos")).toBeTruthy();
    expect(screen.getByText("Hasta 3,66x")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Minijuegos" }).getAttribute("href")).toBe(
      "/games/mini",
    );
    expect(within(road()).getByText("Salida")).toBeTruthy();
    expect(within(road()).getByText("Meta")).toBeTruthy();

    const p = within(panel());
    expect((p.getByLabelText("Tu apuesta") as HTMLInputElement).value).toBe("10");
    expect(p.getByText("Entre 10 y 500 créditos.")).toBeTruthy();
    expect(inPanel("Empezar · 10 créditos")).toBeTruthy();
    expect(p.getByRole("heading", { name: "Así se paga" })).toBeTruthy();
    for (const [lane, mult] of [
      [1, "1,20x"],
      [3, "1,87x"],
      [6, "3,66x"],
    ] as const) {
      expect(p.getByText(`Carril ${lane}`)).toBeTruthy();
      expect(p.getByText(mult)).toBeTruthy();
    }
    expect(
      p.getByText(
        "Cada carril tiene 80 % de probabilidad de cruzarlo. Si te atropellan, pierdes la apuesta.",
      ),
    ).toBeTruthy();

    // Before a game, the block shows the active pair: the one the next game will use.
    const pair = await api.getSeedPair();
    expect(p.getByText("Partida verificable")).toBeTruthy();
    expect(p.getByText("Hash de la semilla del servidor")).toBeTruthy();
    expect(p.getByText(pair.serverSeedHash)).toBeTruthy();
    expect(p.getByText("¿Cómo se verifica?")).toBeTruthy();
    expect(p.getByTestId("cr-nonce").textContent).toBe("0");
  });

  it("keeps the amount within 10 to 500 credits in steps of 10", async () => {
    await renderPage(client());
    const input = within(panel()).getByLabelText("Tu apuesta") as HTMLInputElement;
    expect(input.min).toBe("10");
    expect(input.max).toBe("500");
    expect(input.step).toBe("10");

    for (const value of ["5", "510", "15", ""]) {
      fireEvent.change(input, { target: { value } });
      const start = inPanel(/^Empezar/) as HTMLButtonElement;
      expect(start.disabled).toBe(true);
    }
    fireEvent.change(input, { target: { value: "250" } });
    expect((inPanel("Empezar · 250 créditos") as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(inPanel("500"));
    expect(input.value).toBe("500");
    expect(inPanel("500").getAttribute("aria-pressed")).toBe("true");
    expect(inPanel("10").getAttribute("aria-pressed")).toBe("false");
    expect(inPanel("Empezar · 500 créditos")).toBeTruthy();
  });

  it("sends visitors without a session to the login screen", async () => {
    localStorage.clear();
    const router = createMemoryRouter(routes, { initialEntries: [PATH] });
    render(<App client={client()} router={router} />);
    expect(router.state.location.pathname).toBe("/login");
  });
});

describe("ChickenRoadPage game flow", () => {
  it("starts, steps and cashes out, updating the multiplier, the prize and the balance", async () => {
    await renderPage(client([null]));
    await headerBalance("1,000.00");
    await startGame();

    const p = within(panel());
    expect(p.getByText("Listo para cruzar")).toBeTruthy();
    expect(p.getByText("1,00x")).toBeTruthy();
    expect(p.getByText("Premio posible")).toBeTruthy();
    expect(p.getByText("10 créditos")).toBeTruthy();
    expect(p.getByText("Siguiente carril: 1,20x · 80 % de cruzar")).toBeTruthy();
    // Nothing to cash out before the first lane.
    expect(queryInPanel(/^Retirar/)).toBeNull();
    expect(p.getByText("Da tu primer paso para poder retirar.")).toBeTruthy();
    await headerBalance("990.00");

    await stepOnce();
    expect(p.getByText("Carril 1 de 6")).toBeTruthy();
    expect(p.getByText("1,20x")).toBeTruthy();
    expect(p.getByText("12 créditos")).toBeTruthy();
    expect(inPanel("Retirar 12 créditos")).toBeTruthy();
    expect(within(road()).getAllByRole("img", { name: "Carril cruzado" })).toHaveLength(1);

    await stepOnce();
    expect(p.getByText("Carril 2 de 6")).toBeTruthy();
    expect(p.getByText("1,50x")).toBeTruthy();
    expect(p.getByText("Siguiente carril: 1,87x · 80 % de cruzar")).toBeTruthy();

    await press("Retirar 15 créditos");
    expect(p.getByText("¡Cobraste!")).toBeTruthy();
    expect(p.getByText("15 créditos")).toBeTruthy();
    expect(p.getByText("Ganancia: +5 créditos con 1,50x.")).toBeTruthy();
    expect(inPanel("Jugar otra vez")).toBeTruthy();
    await headerBalance("1,005.00");
  });

  it("shows the hit without 'Habrías cobrado' when the car hits on lane 1", async () => {
    await renderPage(client([1]));
    await startGame();
    await stepOnce();
    const p = within(panel());
    expect(p.getByText("¡Te atropellaron!")).toBeTruthy();
    expect(p.getByText("Perdiste tu apuesta de 10 créditos en el carril 1.")).toBeTruthy();
    expect(p.queryByText(/Habrías cobrado/)).toBeNull();
    expect(inPanel("Jugar otra vez")).toBeTruthy();
  });

  it("tells what retiring would have paid when the car hits after a crossed lane", async () => {
    await renderPage(client([3]));
    await startGame();
    await stepOnce();
    await stepOnce();
    await stepOnce();
    const p = within(panel());
    expect(p.getByText("Perdiste tu apuesta de 10 créditos en el carril 3.")).toBeTruthy();
    expect(p.getByText("Habrías cobrado 15 créditos si te retirabas antes.")).toBeTruthy();
    await headerBalance("990.00");
  });

  it("shows the goal after lane 6, paid automatically", async () => {
    await renderPage(client([null]));
    await startGame();
    for (let lane = 1; lane <= 6; lane++) await stepOnce();
    const p = within(panel());
    expect(p.getByText("¡Cruzaste la calle!")).toBeTruthy();
    expect(p.getByText("36.60 créditos")).toBeTruthy();
    expect(p.getByText("Llegaste a la meta con 3,66x y cobraste automáticamente.")).toBeTruthy();
    await headerBalance("1,026.60");
  });

  it("goes back to the bet form with the next nonce after a game", async () => {
    await renderPage(client([1]));
    await startGame();
    expect(within(panel()).getByTestId("cr-nonce").textContent).toBe("0");
    await stepOnce();
    await press("Jugar otra vez");
    expect(inPanel("Empezar · 10 créditos")).toBeTruthy();
    await waitFor(() => expect(within(panel()).getByTestId("cr-nonce").textContent).toBe("1"), {
      timeout: 4000,
    });
  });

  it("disables the actions while a request is pending", async () => {
    const gate = { open: () => {} };
    const waitGate = () =>
      new Promise<void>((resolve) => {
        gate.open = resolve;
      });
    const calls = { start: 0, step: 0 };
    const api = client([null], (base) => ({
      startChickenRoadGame: async (body, key) => {
        calls.start++;
        await waitGate();
        return base.startChickenRoadGame(body, key);
      },
      stepChickenRoadGame: async (body) => {
        calls.step++;
        await waitGate();
        return base.stepChickenRoadGame(body);
      },
    }));
    await renderPage(api);
    const isDisabled = (name: string | RegExp) => (inPanel(name) as HTMLButtonElement).disabled;

    // Start: a double click sends one request, and the form is locked until it answers.
    fireEvent.click(inPanel(/^Empezar/));
    fireEvent.click(inPanel(/^Empezar/));
    await waitFor(() => expect(isDisabled(/^Empezar/)).toBe(true));
    expect(isDisabled("500")).toBe(true);
    expect((within(panel()).getByLabelText("Tu apuesta") as HTMLInputElement).disabled).toBe(true);
    expect(calls.start).toBe(1);
    gate.open();
    await screen.findByText("Listo para cruzar", {}, { timeout: 4000 });

    // Step: no second step while the first one waits.
    fireEvent.click(inPanel("Siguiente paso"));
    fireEvent.click(inPanel("Siguiente paso"));
    await waitFor(() => expect(isDisabled("Siguiente paso")).toBe(true));
    expect(calls.step).toBe(1);
    gate.open();
    await screen.findByText("Carril 1 de 6", {}, { timeout: 4000 });
    expect(isDisabled("Siguiente paso")).toBe(false);
    expect(isDisabled("Retirar 12 créditos")).toBe(false);
  });

  it("restores a game in progress on load", async () => {
    const api = client([null]);
    const { game } = await api.startChickenRoadGame({ stake: "2000" }, "key-restore-0001");
    await api.stepChickenRoadGame({ gameId: game.gameId, lane: 1 });
    await api.stepChickenRoadGame({ gameId: game.gameId, lane: 2 });

    await renderPage(api);
    const p = within(panel());
    expect(p.getByText("Carril 2 de 6")).toBeTruthy();
    expect(inPanel("Retirar 30 créditos")).toBeTruthy();
    expect(p.getByText(game.fairness.serverSeedHash)).toBeTruthy();
    expect(within(road()).getAllByRole("img", { name: "Carril cruzado" })).toHaveLength(2);
  });
});

describe("ChickenRoadPage errors", () => {
  it("shows insufficient balance and lets the player try again", async () => {
    await renderPage(client([], () => ({}), 500n));
    await startGame();
    expect(alertText()).toBe("Saldo insuficiente.");
    expect((inPanel("Empezar · 10 créditos") as HTMLButtonElement).disabled).toBe(false);
  });

  it("maps an invalid amount and an unexpected error", async () => {
    let next: ApiError = new ApiError("invalid_request", "bad", 400);
    const api = client([], () => ({
      startChickenRoadGame: async () => {
        throw next;
      },
    }));
    await renderPage(api);
    await startGame();
    expect(alertText()).toBe("La apuesta no es válida.");
    next = new ApiError("internal", "boom", 500);
    await startGame();
    expect(alertText()).toBe("Ocurrió un error inesperado. Intente de nuevo.");
  });

  it("retries a start after a network error with the same Idempotency-Key", async () => {
    const keys: string[] = [];
    const api = client([null], (base) => ({
      startChickenRoadGame: async (body, key) => {
        keys.push(key);
        if (keys.length === 1) throw new ApiError("network", "offline", 0);
        return base.startChickenRoadGame(body, key);
      },
    }));
    await renderPage(api);
    await startGame();
    expect(alertText()).toBe("No hay conexión con el servidor. Intente de nuevo.");
    await startGame();
    expect(within(panel()).getByText("Listo para cruzar")).toBeTruthy();
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
  });

  it("restores the game in progress when a start answers 409", async () => {
    const api = client([null], (base) => ({
      startChickenRoadGame: async (body, key) => {
        // Another tab started a game first.
        await base.startChickenRoadGame(body, `${key}-other-tab`);
        throw conflict();
      },
    }));
    await renderPage(api);
    await startGame();
    expect(within(panel()).getByText("Listo para cruzar")).toBeTruthy();
    expect(alertText()).toBe("Ya tienes una partida en curso.");
  });

  it("goes back to the bet form when a replayed start finds the game finished", async () => {
    const api = client([], () => ({
      startChickenRoadGame: async () => {
        throw conflict();
      },
    }));
    await renderPage(api);
    await startGame();
    expect(alertText()).toBe("Esa partida ya terminó.");
    expect(inPanel("Empezar · 10 créditos")).toBeTruthy();
  });

  it("a) restores the real lane, without a message, when another tab advanced the game", async () => {
    const api = client([null], (base) => ({
      stepChickenRoadGame: async ({ gameId }) => {
        await base.stepChickenRoadGame({ gameId, lane: 1 });
        await base.stepChickenRoadGame({ gameId, lane: 2 });
        throw conflict();
      },
    }));
    await renderPage(api);
    await startGame();
    await stepOnce();
    expect(within(panel()).getByText("Carril 2 de 6")).toBeTruthy();
    expect(alertText()).toBeNull();
  });

  it("b) shows the real result of a game that was lost meanwhile", async () => {
    const api = client([1], (base) => ({
      stepChickenRoadGame: async (body) => {
        await base.stepChickenRoadGame(body);
        throw conflict();
      },
    }));
    await renderPage(api);
    await startGame();
    await stepOnce();
    expect(within(panel()).getByText("¡Te atropellaron!")).toBeTruthy();
    expect(alertText()).toBeNull();
  });

  it("b) shows Cobrado, not an expiry, for a game cashed out in another tab", async () => {
    const api = client([null], (base) => ({
      cashOutChickenRoadGame: async (body) => {
        await base.cashOutChickenRoadGame(body);
        throw conflict();
      },
    }));
    await renderPage(api);
    await startGame();
    await stepOnce();
    await press("Retirar 12 créditos");
    expect(within(panel()).getByText("¡Cobraste!")).toBeTruthy();
    expect(within(panel()).getByText("Ganancia: +2 créditos con 1,20x.")).toBeTruthy();
    expect(alertText()).toBeNull();
    await headerBalance("1,002.00");
  });

  it("b) shows Meta for a game that reached the goal meanwhile", async () => {
    const api = client([null], (base) => ({
      stepChickenRoadGame: async ({ gameId }) => {
        for (let lane = 1; lane <= 6; lane++) await base.stepChickenRoadGame({ gameId, lane });
        throw conflict();
      },
    }));
    await renderPage(api);
    await startGame();
    await stepOnce();
    expect(within(panel()).getByText("¡Cruzaste la calle!")).toBeTruthy();
    expect(alertText()).toBeNull();
  });

  it("c) reports a refund only when the game is neither current nor in the history", async () => {
    let expired = false;
    const api = client([null], (base) => ({
      getCurrentChickenRoadGame: async () =>
        expired ? { game: null } : base.getCurrentChickenRoadGame(),
      stepChickenRoadGame: async () => {
        expired = true;
        throw conflict();
      },
    }));
    await api.startChickenRoadGame({ stake: "1000" }, "key-expired-0001");
    await renderPage(api);
    expect(within(panel()).getByText("Listo para cruzar")).toBeTruthy();
    await stepOnce();
    expect(alertText()).toBe("Tu partida expiró y se devolvió tu apuesta.");
    expect(inPanel("Empezar · 10 créditos")).toBeTruthy();
  });

  it("keeps the current state after a network error on a step", async () => {
    let fail = true;
    const api = client([null], (base) => ({
      stepChickenRoadGame: async (body) => {
        if (fail) {
          fail = false;
          throw new ApiError("network", "offline", 0);
        }
        return base.stepChickenRoadGame(body);
      },
    }));
    await renderPage(api);
    await startGame();
    await stepOnce();
    expect(alertText()).toBe("No hay conexión con el servidor. Intente de nuevo.");
    expect(within(panel()).getByText("Listo para cruzar")).toBeTruthy();
    await stepOnce();
    expect(within(panel()).getByText("Carril 1 de 6")).toBeTruthy();
    expect(alertText()).toBeNull();
  });
});

describe("ChickenRoadPage road", () => {
  const lanes = () => Array.from(road().querySelectorAll<HTMLElement>(".cr-lane"));
  const states = () => lanes().map((lane) => lane.dataset.state);
  const pillClass = (lane: number) => lanes()[lane - 1]?.querySelector(".cr-mult")?.className;
  const carLanes = () =>
    lanes()
      .filter((lane) => lane.querySelector(".cr-car-slot:not(.cr-hit-car)"))
      .map((lane) => Number(lane.dataset.lane));
  const chickenAt = () =>
    Number(road().querySelector<HTMLElement>(".cr-chicken-mover")?.dataset.pos ?? -1);

  it("draws the start, the lanes with their pills, the cars and the chicken", async () => {
    await renderPage(client([null]));
    expect(states()).toEqual(["next", "ahead", "ahead", "ahead", "ahead", "ahead"]);
    expect(chickenAt()).toBe(0);
    expect(carLanes()).toEqual([1, 2, 3, 4, 5, 6]);

    await startGame();
    await stepOnce();
    await stepOnce();
    expect(states()).toEqual(["crossed", "crossed", "next", "ahead", "ahead", "ahead"]);
    expect(pillClass(1)).toContain("is-crossed");
    expect(pillClass(3)).toContain("is-next");
    expect(pillClass(4)).toContain("is-ahead");
    expect(within(road()).getAllByRole("img", { name: "Carril cruzado" })).toHaveLength(2);
    // Cars only where the chicken has not crossed yet.
    expect(carLanes()).toEqual([3, 4, 5, 6]);
    expect(chickenAt()).toBe(2);
    // The art is decorative: only the badges and the labels reach assistive technology.
    for (const svg of road().querySelectorAll("svg")) {
      const badge = svg.closest('[role="img"]');
      if (!badge) expect(svg.closest('[aria-hidden="true"]')).not.toBeNull();
    }
  });

  it("puts the chicken on the finish after lane 6, with every lane crossed", async () => {
    await renderPage(client([null]));
    await startGame();
    for (let lane = 1; lane <= 6; lane++) await stepOnce();
    expect(chickenAt()).toBe(7);
    expect(states()).toEqual(Array(6).fill("crossed"));
    expect(carLanes()).toEqual([]);
  });

  it("knocks the chicken over on the hit lane, with the car on top and ¡PAF!", async () => {
    await renderPage(client([3]));
    expect(road().querySelector('[data-testid="cr-hit"]')).toBeNull();
    await startGame();
    for (let lane = 1; lane <= 3; lane++) await stepOnce();
    const hit = within(road()).getByTestId("cr-hit");
    expect(hit.closest(".cr-lane")?.getAttribute("data-lane")).toBe("3");
    expect(hit.querySelector(".cr-hit-car")).not.toBeNull();
    expect(within(hit).getByText("¡PAF!").getAttribute("aria-hidden")).toBe("true");
    expect(chickenAt()).toBe(3);
    expect(road().querySelector(".cr-chicken")?.classList.contains("is-hit")).toBe(true);
    // Lanes past the hit keep their traffic.
    expect(carLanes()).toEqual([4, 5, 6]);
  });

  it("moves the road first and reveals the panel after the jump", async () => {
    setReducedMotion(false);
    await renderPage(client([1]));
    await startGame();
    fireEvent.click(inPanel("Siguiente paso"));
    // The road already shows the hit; the panel still waits, with its buttons locked.
    await waitFor(() => expect(road().querySelector('[data-testid="cr-hit"]')).not.toBeNull());
    expect(within(panel()).getByText("Listo para cruzar")).toBeTruthy();
    expect((inPanel("Siguiente paso") as HTMLButtonElement).disabled).toBe(true);
    await screen.findByText("¡Te atropellaron!", {}, { timeout: 4000 });
    await settled();
  });

  it("lists the latest games: a win as its multiplier, a loss as Atropellado", async () => {
    await renderPage(client([null, 1]));
    expect(screen.queryByRole("list", { name: "Tus últimas partidas" })).toBeNull();

    await startGame();
    await stepOnce();
    await stepOnce();
    await press("Retirar 15 créditos");
    await press("Jugar otra vez");
    await startGame();
    await stepOnce();

    const list = await screen.findByRole("list", { name: "Tus últimas partidas" });
    await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(2));
    const [loss, win] = within(list).getAllByRole("listitem");
    expect(loss?.textContent).toBe("Atropellado");
    expect(loss?.className).toContain("is-lost");
    expect(win?.textContent).toBe("1,50x");
    expect(win?.className).toContain("is-win");
  });
});
