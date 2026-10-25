import type { CrashCurrentResponse, CrashEvent, CrashRound } from "@casino/shared";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../App";
import { type ApiClient, createMockApiClient } from "../../api";
import { routes } from "../../app/routes";
import { seedSession } from "../../test/session";

vi.mock("./useLiveMultiplier", () => ({ useLiveMultiplier: () => 150 }));

const ROUND = "11111111-1111-4111-8111-111111111111";
const HASH = "ab".repeat(32);

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const iso = (ms: number) => new Date(ms).toISOString();

function openResponse(): CrashCurrentResponse {
  const now = Date.now();
  const round: CrashRound = {
    id: ROUND,
    status: "open",
    opensAt: iso(now - 1000),
    closesAt: iso(now + 20_000),
    serverSeedHash: HASH,
  };
  return { round, myBet: null, now: iso(now), limits: { minStake: "1000", maxStake: "50000" } };
}

function aviatorApi() {
  let onEvent: ((event: CrashEvent) => void) | null = null;
  const client: ApiClient = {
    ...createMockApiClient(),
    getBalance: vi.fn(async () => ({ balance: "100000" })),
    getCurrentCrash: vi.fn(async () => openResponse()),
    listCrashHistory: vi.fn(async () => ({ rounds: [] })),
    watchCrash: vi.fn((_game, event, status) => {
      onEvent = event;
      status?.("connected");
      return vi.fn();
    }),
  };
  return { client, emit: (event: CrashEvent) => act(() => onEvent?.(event)) };
}

describe("AviatorPage (Despegue)", () => {
  it("renders as Despegue and never shows the word Aviator", async () => {
    seedSession();
    const api = aviatorApi();
    const router = createMemoryRouter(routes, { initialEntries: ["/games/mini/aviator"] });
    render(<App client={api.client} router={router} />);
    await screen.findByRole("heading", { level: 1, name: "Despegue" });
    await waitFor(() => expect(screen.getByText("Apuestas abiertas.")).toBeTruthy());
    expect(document.body.textContent).not.toMatch(/aviator/i);
    expect(api.client.getCurrentCrash).toHaveBeenCalledWith("aviator");
  });

  it("uses the Despegue impact copy", async () => {
    seedSession();
    const api = aviatorApi();
    const router = createMemoryRouter(routes, { initialEntries: ["/games/mini/aviator"] });
    render(<App client={api.client} router={router} />);
    await screen.findByRole("heading", { level: 1, name: "Despegue" });
    api.emit({ type: "takeoff", roundId: ROUND, startedAt: iso(Date.now()) });
    api.emit({
      type: "impact",
      roundId: ROUND,
      result: { crashHundredths: 245, outcome: "impact" },
      serverSeed: "seed",
    });
    await waitFor(() => expect(screen.getByText("¡Se fue volando! 2,45x")).toBeTruthy());
  });
});
