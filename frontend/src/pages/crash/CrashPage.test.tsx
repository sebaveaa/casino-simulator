import type {
  CrashBetRequest,
  CrashBetResponse,
  CrashCashoutResponse,
  CrashCurrentResponse,
  CrashEvent,
  CrashRound,
} from "@casino/shared";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../App";
import { type ApiClient, createMockApiClient } from "../../api";
import { routes } from "../../app/routes";
import { seedSession } from "../../test/session";

// The live multiplier uses requestAnimationFrame; pin it so the tests are deterministic.
vi.mock("./useLiveMultiplier", () => ({ useLiveMultiplier: () => 150 }));

const ROUND = "11111111-1111-4111-8111-111111111111";
const BET = "33333333-3333-4333-8333-333333333333";
const HASH = "ab".repeat(32);
const SEED = "revealed-seed";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const iso = (ms: number) => new Date(ms).toISOString();

function openRound(): CrashRound {
  const now = Date.now();
  return {
    id: ROUND,
    status: "open",
    opensAt: iso(now - 1000),
    closesAt: iso(now + 20_000),
    serverSeedHash: HASH,
  };
}

function flyingRound(): CrashRound {
  const now = Date.now();
  return { ...openRound(), status: "closed", closesAt: iso(now - 1000) };
}

function resolvedRound(): CrashRound {
  return {
    ...flyingRound(),
    status: "resolved",
    result: { crashHundredths: 245, outcome: "impact" },
    serverSeed: SEED,
  };
}

function current(
  round: CrashRound | null,
  myBet: CrashCurrentResponse["myBet"] = null,
): CrashCurrentResponse {
  return {
    round,
    myBet,
    now: iso(Date.now()),
    limits: { minStake: "1000", maxStake: "50000" },
  };
}

function crashApi(initial: CrashCurrentResponse, history: CrashRound[] = []) {
  let response = initial;
  let onEvent: ((event: CrashEvent) => void) | null = null;
  const getCurrentCrash = vi.fn<ApiClient["getCurrentCrash"]>(async () => ({
    ...response,
    now: iso(Date.now()),
  }));
  const placeCrashBet = vi.fn<ApiClient["placeCrashBet"]>(
    async (_game, body: CrashBetRequest): Promise<CrashBetResponse> => ({
      betId: BET,
      roundId: body.roundId,
      stake: body.stake,
      balance: "99000",
    }),
  );
  const cashOutCrash = vi.fn<ApiClient["cashOutCrash"]>(
    async (): Promise<CrashCashoutResponse> => ({
      betId: BET,
      cashoutHundredths: 180,
      payout: "1800",
      balance: "101800",
    }),
  );
  const watchCrash = vi.fn<ApiClient["watchCrash"]>((_game, event, status) => {
    onEvent = event;
    status?.("connected");
    return vi.fn();
  });
  const listCrashHistory = vi.fn<ApiClient["listCrashHistory"]>(async () => ({ rounds: history }));
  const getBalance = vi.fn<ApiClient["getBalance"]>(async () => ({ balance: "100000" }));

  const client: ApiClient = {
    ...createMockApiClient(),
    getBalance,
    getCurrentCrash,
    placeCrashBet,
    cashOutCrash,
    watchCrash,
    listCrashHistory,
  };
  return {
    client,
    placeCrashBet,
    cashOutCrash,
    setResponse(next: CrashCurrentResponse) {
      response = next;
    },
    emit(event: CrashEvent) {
      act(() => onEvent?.(event));
    },
  };
}

async function renderCrash(client: ApiClient) {
  seedSession();
  const router = createMemoryRouter(routes, { initialEntries: ["/games/mini/dino-crash"] });
  render(<App client={client} router={router} />);
  await screen.findByRole("heading", { level: 1, name: "Dino Crash" });
}

describe("CrashPage (Dino Crash)", () => {
  it("shows the betting phase and the stake form for an open round", async () => {
    const api = crashApi(current(openRound()));
    await renderCrash(api.client);
    await waitFor(() => expect(screen.getByText("Apuestas abiertas.")).toBeTruthy());
    expect(screen.getByLabelText("Monto de tu apuesta")).toBeTruthy();
  });

  it("places a bet and shows the summary", async () => {
    const api = crashApi(current(openRound()));
    await renderCrash(api.client);
    await waitFor(() => expect(screen.getByText("Apuestas abiertas.")).toBeTruthy());
    fireEvent.submit(
      screen.getByLabelText("Monto de tu apuesta").closest("form") as HTMLFormElement,
    );
    await waitFor(() => expect(api.placeCrashBet).toHaveBeenCalled());
    expect(api.placeCrashBet.mock.calls[0]?.[1]).toEqual({ roundId: ROUND, stake: "1000" });
    await waitFor(() => expect(screen.getByText(/Tu apuesta: 10\.00 créditos/)).toBeTruthy());
  });

  it("offers a cash-out when flying with a pending bet, and cashes out", async () => {
    const api = crashApi(
      current(flyingRound(), {
        betId: BET,
        stake: "1000",
        status: "pending",
        cashoutHundredths: null,
        payout: null,
      }),
    );
    await renderCrash(api.client);
    const button = await screen.findByRole("button", { name: /Retirar/ });
    expect(button.textContent).toContain("15.00");
    fireEvent.click(button);
    await waitFor(() => expect(api.cashOutCrash).toHaveBeenCalledWith("dino-crash", BET));
    await waitFor(() => expect(screen.getByText("¡Retiraste!")).toBeTruthy());
    expect(screen.getByText(/Ganaste 18\.00 créditos con 1,80x\./)).toBeTruthy();
  });

  it("announces the impact of a resolved round", async () => {
    const api = crashApi(current(resolvedRound()));
    await renderCrash(api.client);
    await waitFor(() => expect(screen.getByText("¡Impacto! 2,45x")).toBeTruthy());
  });

  it("shows the loss when the settled bet was not cashed out", async () => {
    const settled: CrashRound = { ...resolvedRound(), status: "settled" };
    const api = crashApi(
      current(settled, {
        betId: BET,
        stake: "1000",
        status: "settled",
        cashoutHundredths: null,
        payout: "0",
      }),
    );
    await renderCrash(api.client);
    await waitFor(() => expect(screen.getByText("¡Te alcanzó!")).toBeTruthy());
    expect(screen.getByText(/Perdiste tu apuesta de 10\.00 créditos en 2,45x\./)).toBeTruthy();
  });

  it("lists the recent rounds as pills", async () => {
    const finished: CrashRound = { ...resolvedRound(), status: "settled" };
    const api = crashApi(current(openRound()), [finished]);
    await renderCrash(api.client);
    const history = await screen.findByRole("region", { name: "Últimas rondas" });
    expect(history.textContent).toContain("2,45x");
  });
});
