import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

beforeEach(() => {
  seedSession();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const BET_RESPONSE = {
  betId: "11111111-1111-4111-8111-111111111111",
  result: { number: 17 },
  payout: "0",
  balance: "99000",
  fairness: {
    seedPairId: "22222222-2222-4222-8222-222222222222",
    serverSeedHash: "a".repeat(64),
    clientSeed: "client",
    nonce: 3,
  },
} as const;

function fakeClient(placeRouletteBet: ApiClient["placeRouletteBet"]): ApiClient {
  return { ...createMockApiClient(), placeRouletteBet };
}

function renderRoulette(client: ApiClient) {
  const router = createMemoryRouter(routes, { initialEntries: ["/games/roulette"] });
  render(<App client={client} router={router} />);
}

function chooseAndSpin(selectionName: string, stake = "10") {
  fireEvent.change(screen.getByLabelText("Apuesta en créditos"), { target: { value: stake } });
  fireEvent.click(screen.getByRole("button", { name: selectionName }));
  fireEvent.click(screen.getByRole("button", { name: "Girar" }));
}

describe("RoulettePage", () => {
  it("sends the stake in minor units, the selection and an Idempotency-Key", async () => {
    const place = vi.fn<ApiClient["placeRouletteBet"]>().mockResolvedValue({ ...BET_RESPONSE });
    renderRoulette(fakeClient(place));
    chooseAndSpin("Rojo", "12.5");
    await waitFor(() => expect(place).toHaveBeenCalledTimes(1));
    expect(place.mock.calls[0]?.[0]).toEqual({
      stake: "1250",
      selection: { type: "color", color: "red" },
    });
    expect(place.mock.calls[0]?.[1]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("sends a straight number and a dozen as the right selections", async () => {
    const place = vi.fn<ApiClient["placeRouletteBet"]>().mockResolvedValue({ ...BET_RESPONSE });
    renderRoulette(fakeClient(place));
    chooseAndSpin("Número 7");
    await waitFor(() => expect(place).toHaveBeenCalledTimes(1));
    expect(place.mock.calls[0]?.[0].selection).toEqual({ type: "straight", number: 7 });
    await screen.findByText(/Perdiste/);
    chooseAndSpin("2ª docena (13-24)");
    await waitFor(() => expect(place).toHaveBeenCalledTimes(2));
    expect(place.mock.calls[1]?.[0].selection).toEqual({ type: "dozen", dozen: 2 });
  });

  it("shows the number the server returned, even when local rules would disagree", async () => {
    // 17 is black: a client that computed the outcome itself could not produce this answer.
    const place = vi.fn<ApiClient["placeRouletteBet"]>().mockResolvedValue({
      ...BET_RESPONSE,
      payout: "2000",
    });
    renderRoulette(fakeClient(place));
    chooseAndSpin("Rojo");
    expect(await screen.findByText(/Ganaste 20\.00 créditos/)).toBeTruthy();
    expect(screen.getByTestId("wheel").getAttribute("data-target")).toBe("17");
    expect(screen.getByRole("status").textContent).toContain("17");
    expect(screen.getByRole("status").textContent).toContain("negro");
  });

  it("shows a loss with the stake, the fairness data and refreshes the balance", async () => {
    const place = vi.fn<ApiClient["placeRouletteBet"]>().mockResolvedValue({ ...BET_RESPONSE });
    const getBalance = vi.fn().mockResolvedValue({ balance: "99000" });
    renderRoulette({ ...fakeClient(place), getBalance });
    await waitFor(() => expect(getBalance).toHaveBeenCalledTimes(1));
    chooseAndSpin("Negro", "5");
    expect(await screen.findByText(/Perdiste 5\.00 créditos/)).toBeTruthy();
    expect(screen.getByText("a".repeat(64))).toBeTruthy();
    await waitFor(() => expect(getBalance).toHaveBeenCalledTimes(2));
  });

  it("shows Saldo insuficiente when the server rejects the bet", async () => {
    const place = vi
      .fn<ApiClient["placeRouletteBet"]>()
      .mockRejectedValue(new ApiError("insufficient_funds", "Insufficient funds", 422));
    renderRoulette(fakeClient(place));
    chooseAndSpin("Rojo");
    expect(await screen.findByText("Saldo insuficiente.")).toBeTruthy();
    expect(screen.queryByText(/Perdiste/)).toBeNull();
  });

  it("disables the button while the bet is pending", async () => {
    let resolveBet: (value: typeof BET_RESPONSE) => void = () => {};
    const place = vi.fn<ApiClient["placeRouletteBet"]>().mockReturnValue(
      new Promise((resolve) => {
        resolveBet = resolve;
      }),
    );
    renderRoulette(fakeClient(place));
    chooseAndSpin("Rojo");
    const button = await screen.findByRole("button", { name: "Enviando…" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    resolveBet(BET_RESPONSE);
    await screen.findByText(/Perdiste/);
    expect((screen.getByRole("button", { name: "Girar" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("validates the stake and the selection before calling the API", async () => {
    const place = vi.fn<ApiClient["placeRouletteBet"]>();
    renderRoulette(fakeClient(place));
    fireEvent.click(screen.getByRole("button", { name: "Girar" }));
    expect(await screen.findByText("Elija a qué desea apostar.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Apuesta en créditos"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Girar" }));
    expect(await screen.findByText(/mayor que cero/)).toBeTruthy();
    expect(place).not.toHaveBeenCalled();
  });

  it("reuses the Idempotency-Key when retrying the same bet after a network failure", async () => {
    const place = vi
      .fn<ApiClient["placeRouletteBet"]>()
      .mockRejectedValueOnce(new ApiError("network", "offline", 0))
      .mockResolvedValue({ ...BET_RESPONSE });
    renderRoulette(fakeClient(place));
    chooseAndSpin("Rojo");
    await screen.findByText(/No hay conexión/);
    fireEvent.click(screen.getByRole("button", { name: "Girar" }));
    await screen.findByText(/Perdiste/);
    expect(place.mock.calls[1]?.[1]).toBe(place.mock.calls[0]?.[1]);
    // A new bet gets a new key.
    fireEvent.click(screen.getByRole("button", { name: "Girar" }));
    await waitFor(() => expect(place).toHaveBeenCalledTimes(3));
    expect(place.mock.calls[2]?.[1]).not.toBe(place.mock.calls[0]?.[1]);
  });
});
