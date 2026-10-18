import {
  parseAmount,
  type RouletteBetRequest,
  type RouletteBetResponse,
  spinPayouts,
  toAmount,
  totalStake,
} from "@casino/shared";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { type ApiClient, ApiError, createMockApiClient } from "../api";
import { routes } from "../app/routes";
import { seedSession } from "../test/session";

// jsdom has no WebGL: the wheel reports the end of the spin right away.
vi.mock("./roulette/RouletteWheel", async () => {
  const { useEffect } = await import("react");
  return {
    RouletteWheel: (props: { target: number | null; spinId: number; onSpinEnd: () => void }) => {
      const { target, spinId, onSpinEnd } = props;
      useEffect(() => {
        if (target !== null) onSpinEnd();
      }, [spinId]);
      return <div data-testid="wheel" data-target={target ?? ""} />;
    },
  };
});

/** jsdom has no `matchMedia`: without it motion is on, so the result plays its sequence. */
function setReducedMotion(reduced: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduced && query.includes("prefers-reduced-motion"),
  }));
}

beforeEach(() => {
  seedSession();
  // Most tests look at the end of the result sequence, which reduced motion shows at once.
  setReducedMotion(true);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

const FAIRNESS: RouletteBetResponse["fairness"] = {
  seedPairId: "22222222-2222-4222-8222-222222222222",
  serverSeedHash: "a".repeat(64),
  clientSeed: "client",
  nonce: 3,
};

/** What the server answers for `request` when `number` comes up, using the shared rules. */
function settle(request: RouletteBetRequest, number: number): RouletteBetResponse {
  const spin = request.bets.map(({ stake, selection }) => ({
    stake: parseAmount(stake),
    selection,
  }));
  const { payouts, total } = spinPayouts(spin, { number });
  const stake = totalStake(spin);
  return {
    betId: crypto.randomUUID(),
    result: { number },
    bets: request.bets.map((bet, i) => ({ ...bet, payout: toAmount(payouts[i] ?? 0n) })),
    stake: toAmount(stake),
    payout: toAmount(total),
    balance: toAmount(100000n - stake + total),
    fairness: FAIRNESS,
  };
}

type Place = ApiClient["placeRouletteBet"];

function fakeClient(placeRouletteBet: Place): ApiClient {
  return { ...createMockApiClient(), placeRouletteBet };
}

/** A fake API that settles every spin on `number`. */
function settlingOn(number: number) {
  return vi.fn<Place>(async (request) => settle(request, number));
}

async function renderRoulette(client: ApiClient) {
  const router = createMemoryRouter(routes, { initialEntries: ["/games/roulette"] });
  render(<App client={client} router={router} />);
  // The balance shows in the header and above the table once it loads.
  await screen.findAllByText("1,000.00");
}

function chip(value: number) {
  fireEvent.click(
    screen.getByRole("button", { name: new RegExp(`^Ficha de ${value} créditos?$`) }),
  );
}

/** A cell of the felt by its name, e.g. "Rojo" or "Número 17". */
function cell(name: string) {
  return screen.getByRole("button", { name: new RegExp(`^${name},`) });
}

function spinButton() {
  return screen.getByRole("button", { name: /^(Girar|Enviando…|Girando…)$/ }) as HTMLButtonElement;
}

function summaryItem(name: string) {
  return within(screen.getByRole("list", { name: "Resumen de la apuesta" })).getByTitle(name);
}

describe("RoulettePage table", () => {
  it("stacks the selected chip on a cell and shows the accumulated amount", async () => {
    await renderRoulette(fakeClient(settlingOn(17)));
    chip(25);
    fireEvent.click(cell("Rojo"));
    chip(5);
    fireEvent.click(cell("Rojo"));
    expect(cell("Rojo").getAttribute("aria-label")).toContain("apostado 30 créditos");
    expect(within(cell("Rojo")).getByText("30")).toBeTruthy();
    expect(cell("Negro").getAttribute("aria-label")).not.toContain("apostado");
  });

  it("marks the selected chip", async () => {
    await renderRoulette(fakeClient(settlingOn(17)));
    chip(25);
    const pressed = screen
      .getAllByRole("button", { name: /^Ficha de/ })
      .filter((button) => button.getAttribute("aria-pressed") === "true");
    expect(pressed.map((button) => button.textContent)).toEqual(["25"]);
  });

  it("badges every cell with the multiplier from the rules", async () => {
    await renderRoulette(fakeClient(settlingOn(17)));
    expect(within(cell("Número 7")).getByText("x36").className).toContain("roulette-mult-36");
    expect(within(cell("Rojo")).getByText("x2").className).toContain("roulette-mult-2");
    expect(within(cell("Par")).getByText("x2")).toBeTruthy();
    expect(within(cell("2ª docena \\(13-24\\)")).getByText("x3").className).toContain(
      "roulette-mult-3",
    );
    expect(screen.queryByText(/paga/i)).toBeNull();
    // Only cells with chips carry the extra corner badge.
    fireEvent.click(cell("Rojo"));
    expect(within(cell("Rojo")).getAllByText("x2")).toHaveLength(2);
  });

  it("undoes the last chip, clears the table and doubles every stack", async () => {
    await renderRoulette(fakeClient(settlingOn(17)));
    chip(10);
    fireEvent.click(cell("Rojo"));
    fireEvent.click(cell("Número 17"));
    fireEvent.click(cell("Número 17"));
    expect(summaryItem("Apuesta total").textContent).toContain("30");

    fireEvent.click(screen.getByRole("button", { name: "Deshacer" }));
    expect(summaryItem("Apuesta total").textContent).toContain("20");
    expect(summaryItem("Número de apuestas").textContent).toContain("2");

    fireEvent.click(screen.getByRole("button", { name: "Doblar" }));
    expect(summaryItem("Apuesta total").textContent).toContain("40");
    expect(cell("Rojo").getAttribute("aria-label")).toContain("apostado 20 créditos");

    fireEvent.click(screen.getByRole("button", { name: "Limpiar" }));
    expect(summaryItem("Apuesta total").textContent).toContain("0");
    expect(summaryItem("Número de apuestas").textContent).toContain("0");
    expect(cell("Rojo").getAttribute("aria-label")).not.toContain("apostado");
  });

  it("shows the total staked, the best possible win, the bet count and the balance after", async () => {
    await renderRoulette(fakeClient(settlingOn(17)));
    chip(10);
    fireEvent.click(cell("Rojo"));
    fireEvent.click(cell("Número 17"));
    // 17 is black: the straight pays 36 x 10 and red loses; any red pocket returns only 2 x 10.
    expect(summaryItem("Apuesta total").textContent).toContain("20");
    expect(
      summaryItem("Ganancia máxima si acierta todo lo posible en un giro").textContent,
    ).toContain("360");
    expect(summaryItem("Número de apuestas").textContent).toContain("2");
    expect(summaryItem("Saldo tras apostar").textContent).toContain("980");
  });
});

describe("RoulettePage spin", () => {
  it("sends one request with every bet, in the order they were chosen, and one key", async () => {
    const place = settlingOn(17);
    await renderRoulette(fakeClient(place));
    chip(25);
    fireEvent.click(cell("Rojo"));
    fireEvent.click(cell("Rojo"));
    chip(5);
    fireEvent.click(cell("Número 17"));
    fireEvent.click(cell("1ª docena \\(1-12\\)"));
    fireEvent.click(spinButton());
    await waitFor(() => expect(place).toHaveBeenCalledTimes(1));
    expect(place.mock.calls[0]?.[0]).toEqual({
      bets: [
        { stake: "5000", selection: { type: "color", color: "red" } },
        { stake: "500", selection: { type: "straight", number: 17 } },
        { stake: "500", selection: { type: "dozen", dozen: 1 } },
      ],
    });
    expect(place.mock.calls[0]?.[1]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("disables Girar with nothing staked and enables it once there is a chip", async () => {
    await renderRoulette(fakeClient(settlingOn(17)));
    expect(spinButton().disabled).toBe(true);
    fireEvent.click(cell("Negro"));
    expect(spinButton().disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Limpiar" }));
    expect(spinButton().disabled).toBe(true);
  });

  it("disables Girar and warns when the total exceeds the balance", async () => {
    const place = settlingOn(17);
    await renderRoulette(fakeClient(place));
    chip(100);
    for (let i = 0; i < 10; i++) fireEvent.click(cell("Rojo"));
    // 1,000 credits staked of 1,000: still allowed.
    expect(spinButton().disabled).toBe(false);
    expect(summaryItem("Saldo tras apostar").textContent).toContain("0");
    fireEvent.click(cell("Rojo"));
    expect(spinButton().disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toBe("La apuesta total supera su saldo.");
    expect(summaryItem("Saldo tras apostar").textContent).toContain("−100");
    fireEvent.click(spinButton());
    expect(place).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Deshacer" }));
    expect(spinButton().disabled).toBe(false);
  });

  it("shows the sequence, the net, the winning bets and the highlighted cells", async () => {
    const place = settlingOn(17);
    await renderRoulette(fakeClient(place));
    chip(10);
    fireEvent.click(cell("Rojo"));
    chip(1);
    fireEvent.click(cell("Número 17"));
    fireEvent.click(spinButton());

    // Staked 11, returned 36 (the straight on 17): net +25.
    expect((await screen.findByTestId("spin-net")).textContent).toBe("+25");
    expect(screen.getByText("¡Gana!")).toBeTruthy();
    const winners = within(screen.getByRole("list", { name: "Apuestas ganadoras" }));
    expect(winners.getAllByRole("listitem")).toHaveLength(1);
    expect(winners.getByText("x36")).toBeTruthy();
    expect(winners.getByText("17", { exact: false })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Salió el 17, negro.");
    expect(screen.getByTestId("wheel").getAttribute("data-target")).toBe("17");

    // 17 and the black, odd, 2nd dozen cells pulse; the losing red chip fades.
    expect(cell("Número 17").className).toContain("is-win");
    expect(cell("Negro").className).toContain("is-win");
    expect(cell("Rojo").className).not.toContain("is-win");
    expect(within(cell("Rojo")).getByText("10").className).toContain("is-lose");
    expect(within(cell("Número 17")).getByText("1").className).toContain("is-win");
    expect(
      within(screen.getByRole("list", { name: "Últimos resultados" })).getByText("17"),
    ).toBeTruthy();
  });

  it("shows a partial result when a bet wins but the spin loses money", async () => {
    // 4 is black: the red bet loses, black returns 2 x 1 of the 11 staked.
    await renderRoulette(fakeClient(settlingOn(4)));
    chip(10);
    fireEvent.click(cell("Rojo"));
    chip(1);
    fireEvent.click(cell("Negro"));
    fireEvent.click(spinButton());
    expect((await screen.findByTestId("spin-net")).textContent).toBe("−9");
    expect(screen.getByText("Parcial")).toBeTruthy();
  });

  it("shows a loss with the stake, the fairness data and refreshes the balance", async () => {
    const getBalance = vi.fn().mockResolvedValue({ balance: "100000" });
    await renderRoulette({ ...fakeClient(settlingOn(17)), getBalance });
    await waitFor(() => expect(getBalance).toHaveBeenCalledTimes(1));
    chip(5);
    fireEvent.click(cell("Rojo"));
    fireEvent.click(spinButton());
    expect((await screen.findByTestId("spin-net")).textContent).toBe("−5");
    expect(screen.getByText("Pierde")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Apuestas ganadoras" })).toBeNull();
    expect(screen.getByText("a".repeat(64))).toBeTruthy();
    await waitFor(() => expect(getBalance).toHaveBeenCalledTimes(2));
  });

  it("shows the number the server returned, even when local rules would disagree", async () => {
    // 17 is black: a client that computed the outcome itself could not pay this red bet.
    const place = vi.fn<Place>(async (request) => ({
      ...settle(request, 17),
      bets: request.bets.map((bet) => ({ ...bet, payout: "2000" })),
      payout: "2000",
    }));
    await renderRoulette(fakeClient(place));
    chip(10);
    fireEvent.click(cell("Rojo"));
    fireEvent.click(spinButton());
    expect((await screen.findByTestId("spin-net")).textContent).toBe("+10");
    expect(screen.getByTestId("wheel").getAttribute("data-target")).toBe("17");
    expect(screen.getByRole("status").textContent).toContain("negro");
    expect(cell("Rojo").className).not.toContain("is-win");
  });

  it("plays the result as a sequence that a click skips", async () => {
    setReducedMotion(false);
    await renderRoulette(fakeClient(settlingOn(17)));
    chip(5);
    fireEvent.click(cell("Rojo"));
    fireEvent.click(spinButton());
    const skip = await screen.findByRole("button", { name: "Mostrar el resultado final" });
    // The first step of a loss is what was staked; the net comes last.
    expect(screen.getByText("−5")).toBeTruthy();
    expect(screen.queryByTestId("spin-net")).toBeNull();
    fireEvent.click(skip);
    expect(screen.getByTestId("spin-net").textContent).toBe("−5");
    expect(screen.queryByRole("button", { name: "Mostrar el resultado final" })).toBeNull();
  });

  it("keeps the last 12 results, newest first", async () => {
    const results = Array.from({ length: 13 }, (_, i) => i + 1);
    let spun = 0;
    const place = vi.fn<Place>(async (request) => settle(request, results[spun++] ?? 0));
    await renderRoulette(fakeClient(place));
    chip(1);
    fireEvent.click(cell("Rojo"));
    for (const [i, number] of results.entries()) {
      if (i > 0) fireEvent.click(screen.getByRole("button", { name: "Repetir" }));
      fireEvent.click(spinButton());
      await screen.findByText(new RegExp(`^Salió el ${number},`));
    }
    const items = within(screen.getByRole("list", { name: "Últimos resultados" })).getAllByRole(
      "listitem",
    );
    expect(items.map((item) => item.textContent)).toEqual(results.slice(1).reverse().map(String));
    expect(items[0]?.className).toContain("is-latest");
  });
});

describe("RoulettePage after a spin", () => {
  it("keeps the chips for the result, stops counting them and starts a new slip on the next chip", async () => {
    const place = settlingOn(17);
    await renderRoulette(fakeClient(place));
    chip(10);
    fireEvent.click(cell("Rojo"));
    fireEvent.click(spinButton());
    await screen.findByTestId("spin-net");
    expect(cell("Rojo").getAttribute("aria-label")).toContain("apostado 10 créditos");
    expect(summaryItem("Número de apuestas").textContent).toContain("0");
    expect(spinButton().disabled).toBe(true);

    fireEvent.click(cell("Negro"));
    expect(screen.queryByTestId("spin-net")).toBeNull();
    expect(cell("Rojo").getAttribute("aria-label")).not.toContain("apostado");
    expect(summaryItem("Número de apuestas").textContent).toContain("1");
    expect(spinButton().disabled).toBe(false);
  });

  it("repeats the bets of the last spin", async () => {
    const place = settlingOn(17);
    await renderRoulette(fakeClient(place));
    expect((screen.getByRole("button", { name: "Repetir" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    chip(25);
    fireEvent.click(cell("Rojo"));
    chip(1);
    fireEvent.click(cell("Número 4"));
    fireEvent.click(spinButton());
    await screen.findByTestId("spin-net");

    fireEvent.click(screen.getByRole("button", { name: "Repetir" }));
    fireEvent.click(spinButton());
    await waitFor(() => expect(place).toHaveBeenCalledTimes(2));
    expect(place.mock.calls[1]?.[0]).toEqual(place.mock.calls[0]?.[0]);
    expect(place.mock.calls[1]?.[1]).not.toBe(place.mock.calls[0]?.[1]);
  });
});

describe("RoulettePage errors and retries", () => {
  it("shows Saldo insuficiente when the server rejects the spin", async () => {
    const place = vi
      .fn<Place>()
      .mockRejectedValue(new ApiError("insufficient_funds", "Insufficient funds", 422));
    await renderRoulette(fakeClient(place));
    fireEvent.click(cell("Rojo"));
    fireEvent.click(spinButton());
    expect(await screen.findByText("Saldo insuficiente.")).toBeTruthy();
    expect(screen.queryByTestId("spin-net")).toBeNull();
    // The chips are still there to try again.
    expect(cell("Rojo").getAttribute("aria-label")).toContain("apostado");
  });

  it.each([
    ["unauthorized", "Inicie sesión para continuar."],
    ["invalid_request", "La apuesta no es válida."],
    ["internal", "Ocurrió un error inesperado. Intente de nuevo."],
  ] as const)("explains a %s error", async (code, message) => {
    const place = vi.fn<Place>().mockRejectedValue(new ApiError(code, "failed", 400));
    await renderRoulette(fakeClient(place));
    fireEvent.click(cell("Rojo"));
    fireEvent.click(spinButton());
    expect(await screen.findByText(message)).toBeTruthy();
  });

  it("disables everything while the spin is pending", async () => {
    let resolveBet: (value: RouletteBetResponse) => void = () => {};
    const place = vi.fn<Place>().mockReturnValue(
      new Promise((resolve) => {
        resolveBet = resolve;
      }),
    );
    await renderRoulette(fakeClient(place));
    fireEvent.click(cell("Rojo"));
    fireEvent.click(spinButton());
    const button = await screen.findByRole("button", { name: "Enviando…" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect((cell("Negro") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Limpiar" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    resolveBet(
      settle({ bets: [{ stake: "500", selection: { type: "color", color: "red" } }] }, 17),
    );
    await screen.findByTestId("spin-net");
    expect((cell("Negro") as HTMLButtonElement).disabled).toBe(false);
  });

  it("reuses the Idempotency-Key when retrying the same bets after a network failure", async () => {
    const place = vi
      .fn<Place>()
      .mockRejectedValueOnce(new ApiError("network", "offline", 0))
      .mockImplementation(async (request) => settle(request, 17));
    await renderRoulette(fakeClient(place));
    fireEvent.click(cell("Rojo"));
    fireEvent.click(spinButton());
    await screen.findByText(/No hay conexión/);
    fireEvent.click(spinButton());
    await screen.findByTestId("spin-net");
    expect(place.mock.calls[1]?.[1]).toBe(place.mock.calls[0]?.[1]);
    expect(place.mock.calls[1]?.[0]).toEqual(place.mock.calls[0]?.[0]);
    // A new spin gets a new key.
    fireEvent.click(screen.getByRole("button", { name: "Repetir" }));
    fireEvent.click(spinButton());
    await waitFor(() => expect(place).toHaveBeenCalledTimes(3));
    expect(place.mock.calls[2]?.[1]).not.toBe(place.mock.calls[0]?.[1]);
  });

  it("uses a new key when the bets change after a network failure", async () => {
    const place = vi
      .fn<Place>()
      .mockRejectedValueOnce(new ApiError("network", "offline", 0))
      .mockImplementation(async (request) => settle(request, 17));
    await renderRoulette(fakeClient(place));
    fireEvent.click(cell("Rojo"));
    fireEvent.click(spinButton());
    await screen.findByText(/No hay conexión/);
    fireEvent.click(cell("Rojo"));
    fireEvent.click(spinButton());
    await waitFor(() => expect(place).toHaveBeenCalledTimes(2));
    expect(place.mock.calls[1]?.[1]).not.toBe(place.mock.calls[0]?.[1]);
    expect(place.mock.calls[1]?.[0].bets[0]?.stake).toBe("1000");
  });
});
