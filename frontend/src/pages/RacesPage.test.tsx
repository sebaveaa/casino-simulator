import type {
  CurrentRaceResponse,
  RaceBetRequest,
  RaceBetResponse,
  RaceEvent,
  RaceRound,
} from "@casino/shared";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { type ApiClient, ApiError, createMockApiClient } from "../api";
import { routes } from "../app/routes";
import { seedSession } from "../test/session";

// The real track needs WebGL and has its own tests. This stand-in exposes what the page passes and
// lets a test end the animation.
vi.mock("./races/RaceTrack", () => ({
  RaceTrack: (props: {
    order: number[] | null;
    startedAtMs: number | null;
    durationMs: number;
    now?: () => number;
    onFinish?: () => void;
  }) => (
    <div
      data-testid="track"
      data-order={props.order ? props.order.join(",") : ""}
      data-started={props.startedAtMs ?? ""}
      data-duration={props.durationMs}
      data-clock={props.now ? String(props.now()) : ""}
    >
      <button type="button" onClick={() => props.onFinish?.()}>
        end-animation
      </button>
    </div>
  ),
}));

const ROUND_A = "11111111-1111-4111-8111-111111111111";
const ROUND_B = "22222222-2222-4222-8222-222222222222";
const HASH = "ab".repeat(32);
const SEED = "revealed-server-seed";
/** What the fake server reports as its race settings. */
const RACE_DURATION_MS = 10_000;
const LIMITS = { minStake: "100", maxStake: "100000" };
const ORDER = [2, 0, 4, 1, 3];
/** The server clock runs one hour ahead of the browser in these tests. */
const SERVER_AHEAD_MS = 3_600_000;

function serverNow(): number {
  return Date.now() + SERVER_AHEAD_MS;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * An open round closing `closesInMs` from now. Rounds pushed after the first fetch close half a
 * second short of the shown value: the page's clock offset is a few ms behind (the fetch takes
 * time), so an exact boundary would round up to the next second.
 */
function openRound(id = ROUND_A, closesInMs = 25_000): RaceRound {
  const now = serverNow();
  return {
    id,
    status: "open",
    opensAt: iso(now - 5_000),
    closesAt: iso(now + closesInMs),
    serverSeedHash: HASH,
  };
}

function resolvedRound(id = ROUND_A, settlesInMs = 4_000): RaceRound {
  const now = serverNow();
  return {
    id,
    status: "resolved",
    opensAt: iso(now - 40_000),
    closesAt: iso(now - 6_000),
    serverSeedHash: HASH,
    result: { winner: ORDER[0] as number, order: ORDER },
    serverSeed: SEED,
    settlesAt: iso(now + settlesInMs),
  };
}

function current(
  round: RaceRound | null,
  myBet: CurrentRaceResponse["myBet"] = null,
  settings: Partial<Pick<CurrentRaceResponse, "limits" | "raceDurationMs">> = {},
): CurrentRaceResponse {
  return {
    round,
    myBet,
    now: iso(serverNow()),
    limits: LIMITS,
    raceDurationMs: RACE_DURATION_MS,
    ...settings,
  };
}

/**
 * A fake API whose race stream the test drives. `getCurrentRace` answers whatever `race` holds at
 * the time of the call.
 */
function raceApi(initial: CurrentRaceResponse, options: { deferConnect?: boolean } = {}) {
  let race = initial;
  let balance = "100000";
  let onEvent: ((event: RaceEvent) => void) | null = null;
  let onStatus: ((status: "connected" | "reconnecting") => void) | null = null;
  const unsubscribe = vi.fn();

  const getCurrentRace = vi.fn<ApiClient["getCurrentRace"]>(async () => ({
    ...race,
    now: iso(serverNow()),
  }));
  const placeRaceBet = vi.fn<ApiClient["placeRaceBet"]>(
    async (body: RaceBetRequest): Promise<RaceBetResponse> => ({
      betId: "33333333-3333-4333-8333-333333333333",
      roundId: body.roundId,
      animal: body.animal,
      stake: body.stake,
      balance: "99000",
    }),
  );
  const getBalance = vi.fn<ApiClient["getBalance"]>(async () => ({ balance }));
  const watchRaces = vi.fn<ApiClient["watchRaces"]>((event, status) => {
    onEvent = event;
    onStatus = status ?? null;
    if (!options.deferConnect) status?.("connected");
    return unsubscribe;
  });

  const client: ApiClient = {
    ...createMockApiClient(),
    getBalance,
    getCurrentRace,
    placeRaceBet,
    watchRaces,
  };

  return {
    client,
    getCurrentRace,
    placeRaceBet,
    getBalance,
    watchRaces,
    unsubscribe,
    setRace(next: CurrentRaceResponse) {
      race = next;
    },
    setBalance(next: string) {
      balance = next;
    },
    emit(event: RaceEvent) {
      act(() => onEvent?.(event));
    },
    status(next: "connected" | "reconnecting") {
      act(() => onStatus?.(next));
    },
  };
}

async function renderRaces(client: ApiClient) {
  const router = createMemoryRouter(routes, { initialEntries: ["/games/races"] });
  const view = render(<App client={client} router={router} />);
  await screen.findByRole("heading", { level: 1, name: "Carreras de animales" });
  return view;
}

function statusText(): string {
  return screen.getByRole("status", { name: "Estado de la carrera" }).textContent ?? "";
}

function animalRadio(name: string) {
  return screen.getByRole("radio", { name: new RegExp(name) }) as HTMLInputElement;
}

function amountInput() {
  return screen.getByLabelText("Monto en créditos") as HTMLInputElement;
}

function betButton() {
  return screen.getByRole("button", { name: /^(Apostar|Apostando…)$/ }) as HTMLButtonElement;
}

function bet(animal: string, credits: string) {
  fireEvent.click(animalRadio(animal));
  fireEvent.change(amountInput(), { target: { value: credits } });
  fireEvent.click(betButton());
}

beforeEach(() => {
  seedSession();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
});

describe("RacesPage open round", () => {
  it("fetches the current race on mount and counts down with the server clock", async () => {
    const api = raceApi(current(openRound(ROUND_A, 25_000)));
    await renderRaces(api.client);
    expect(api.getCurrentRace).toHaveBeenCalled();
    // The browser clock is one hour behind: it would read 60:25.
    expect(await screen.findByText("00:25")).toBeTruthy();
    const track = screen.getByTestId("track");
    expect(Math.abs(Number(track.dataset.clock) - serverNow())).toBeLessThan(2_000);
    expect(track.dataset.duration).toBe(String(RACE_DURATION_MS));
  });

  it("takes the animation length from the server, not from a constant", async () => {
    const api = raceApi(current(openRound(), null, { raceDurationMs: 6_000 }));
    await renderRaces(api.client);
    await screen.findByText("00:25");
    expect(screen.getByTestId("track").dataset.duration).toBe("6000");
  });

  it("shows the server's stake limits in the hint", async () => {
    const api = raceApi(
      current(openRound(), null, { limits: { minStake: "500", maxStake: "2000" } }),
    );
    await renderRaces(api.client);
    expect(await screen.findByText(/Mínimo 5, máximo 20 créditos\./)).toBeTruthy();
  });

  it("ticks the countdown every second and stops at zero", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const api = raceApi(current(openRound(ROUND_A, 3_000)));
    await renderRaces(api.client);
    expect(await screen.findByText("00:03")).toBeTruthy();
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(screen.getByText("00:02")).toBeTruthy();
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(screen.getByText("00:00")).toBeTruthy();
    expect(betButton().disabled).toBe(true);
  });

  it("offers five animals as a radio group, an amount field and the published hash", async () => {
    const api = raceApi(current(openRound()));
    await renderRaces(api.client);
    const group = await screen.findByRole("radiogroup", { name: "Elija un animal" });
    expect(within(group).getAllByRole("radio")).toHaveLength(5);
    for (const name of ["Tortuga", "Conejo", "Zorro", "Caballo", "Guepardo"]) {
      expect(animalRadio(name)).toBeTruthy();
    }
    expect(amountInput()).toBeTruthy();
    expect(betButton().disabled).toBe(false);
    const details = screen.getByText("Datos de equidad").closest("details") as HTMLElement;
    expect(within(details).getByText(HASH)).toBeTruthy();
    expect(within(details).queryByText(SEED)).toBeNull();
    expect(statusText()).toContain("Apuestas abiertas");
  });

  it("marks the selected animal", async () => {
    const api = raceApi(current(openRound()));
    await renderRaces(api.client);
    fireEvent.click(await screen.findByRole("radio", { name: /Zorro/ }));
    expect(animalRadio("Zorro").checked).toBe(true);
    expect(animalRadio("Tortuga").checked).toBe(false);
  });
});

describe("RacesPage betting", () => {
  it("bets with a stable key across a network retry, then locks the form", async () => {
    const api = raceApi(current(openRound()));
    api.placeRaceBet.mockRejectedValueOnce(new ApiError("network", "offline", 0));
    await renderRaces(api.client);
    await screen.findAllByText("1,000.00");

    bet("Zorro", "10");
    expect(
      await screen.findByText("No hay conexión con el servidor. Intente de nuevo."),
    ).toBeTruthy();
    fireEvent.click(betButton());

    expect(await screen.findByText("Apuesta registrada: Zorro, 10 créditos")).toBeTruthy();
    expect(api.placeRaceBet).toHaveBeenCalledTimes(2);
    const [first, second] = api.placeRaceBet.mock.calls;
    expect(first?.[0]).toEqual({ roundId: ROUND_A, animal: 2, stake: "1000" });
    expect(second?.[0]).toEqual(first?.[0]);
    expect(second?.[1]).toBe(first?.[1]);

    expect(betButton().disabled).toBe(true);
    expect(amountInput().disabled).toBe(true);
    expect(animalRadio("Tortuga").disabled).toBe(true);
    expect(screen.getByText("Podrá apostar en la siguiente ronda.")).toBeTruthy();
    // The balance comes from the bet response.
    expect(screen.getAllByText("990.00").length).toBeGreaterThan(0);
  });

  it("uses a new key for a different bet", async () => {
    const api = raceApi(current(openRound()));
    api.placeRaceBet.mockRejectedValueOnce(new ApiError("network", "offline", 0));
    await renderRaces(api.client);
    bet("Zorro", "10");
    await screen.findByText("No hay conexión con el servidor. Intente de nuevo.");
    bet("Zorro", "20");
    await screen.findByText("Apuesta registrada: Zorro, 20 créditos");
    const [first, second] = api.placeRaceBet.mock.calls;
    expect(second?.[1]).not.toBe(first?.[1]);
  });

  it("sends a bet only once while it is being submitted", async () => {
    const api = raceApi(current(openRound()));
    let answer: (response: RaceBetResponse) => void = () => {};
    api.placeRaceBet.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    await renderRaces(api.client);
    bet("Conejo", "5");
    fireEvent.click(betButton());
    fireEvent.submit(betButton().closest("form") as HTMLFormElement);
    expect(api.placeRaceBet).toHaveBeenCalledTimes(1);
    expect(betButton().textContent).toBe("Apostando…");
    expect(betButton().disabled).toBe(true);
    await act(async () =>
      answer({
        betId: "33333333-3333-4333-8333-333333333333",
        roundId: ROUND_A,
        animal: 1,
        stake: "500",
        balance: "99500",
      }),
    );
    expect(await screen.findByText("Apuesta registrada: Conejo, 5 créditos")).toBeTruthy();
  });

  it.each([
    ["insufficient_funds", "Saldo insuficiente."],
    ["conflict", "Ya apostó en esta carrera."],
    ["invalid_request", "La apuesta no es válida o la ronda ya cerró."],
    ["network", "No hay conexión con el servidor. Intente de nuevo."],
    ["unauthorized", "Inicie sesión para continuar."],
    ["internal", "Ocurrió un error inesperado. Intente de nuevo."],
  ] as const)("maps %s to its message", async (code, message) => {
    const api = raceApi(current(openRound()));
    api.placeRaceBet.mockRejectedValueOnce(new ApiError(code, "failed", 400));
    await renderRaces(api.client);
    bet("Tortuga", "3");
    expect((await screen.findByRole("alert")).textContent).toBe(message);
  });

  it("rejects an amount that is not a whole number of credits within the limits", async () => {
    const api = raceApi(current(openRound()));
    await renderRaces(api.client);
    for (const value of ["0", "2.5", "abc", "1001"]) {
      bet("Tortuga", value);
      expect(
        await screen.findByText("Ingrese un número entero de créditos entre 1 y 1,000."),
      ).toBeTruthy();
    }
    expect(api.placeRaceBet).not.toHaveBeenCalled();
  });

  it("validates the amount against the limits the server reported", async () => {
    const api = raceApi(
      current(openRound(), null, { limits: { minStake: "500", maxStake: "2000" } }),
    );
    await renderRaces(api.client);
    for (const value of ["4", "21"]) {
      bet("Tortuga", value);
      expect(
        await screen.findByText("Ingrese un número entero de créditos entre 5 y 20."),
      ).toBeTruthy();
    }
    expect(api.placeRaceBet).not.toHaveBeenCalled();
    bet("Tortuga", "20");
    await screen.findByText("Apuesta registrada: Tortuga, 20 créditos");
    expect(api.placeRaceBet.mock.calls[0]?.[0].stake).toBe("2000");
  });

  it("offers no bet before the first answer arrives", async () => {
    const api = raceApi(current(openRound()));
    api.getCurrentRace.mockImplementation(() => new Promise(() => {}));
    await renderRaces(api.client);
    expect(statusText()).toContain("Cargando la carrera…");
    expect(screen.queryByRole("button", { name: "Apostar" })).toBeNull();
  });

  it("asks for an animal before betting", async () => {
    const api = raceApi(current(openRound()));
    await renderRaces(api.client);
    fireEvent.change(await screen.findByLabelText("Monto en créditos"), {
      target: { value: "10" },
    });
    fireEvent.click(betButton());
    expect(await screen.findByText("Elija un animal antes de apostar.")).toBeTruthy();
    expect(api.placeRaceBet).not.toHaveBeenCalled();
  });

  it("restores the player's bet after a reload", async () => {
    const api = raceApi(current(openRound(), { animal: 3, stake: "2500", payout: null }));
    await renderRaces(api.client);
    expect(await screen.findByText("Apuesta registrada: Caballo, 25 créditos")).toBeTruthy();
    expect(betButton().disabled).toBe(true);
    expect(screen.getByText("Podrá apostar en la siguiente ronda.")).toBeTruthy();
  });
});

describe("RacesPage round lifecycle", () => {
  it("shows the closed notice with the player's bet", async () => {
    const api = raceApi(current(openRound()));
    await renderRaces(api.client);
    bet("Zorro", "10");
    await screen.findByText("Apuesta registrada: Zorro, 10 créditos");
    api.emit({ type: "closed", roundId: ROUND_A });
    expect(statusText()).toContain("Apuestas cerradas. La carrera comienza en unos instantes.");
    expect(screen.getByText("Apuesta registrada: Zorro, 10 créditos")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Apostar" })).toBeNull();
  });

  it("animates the result order and hides the outcome until the animation ends", async () => {
    const api = raceApi(current(openRound()));
    await renderRaces(api.client);
    await screen.findByText("00:25", { exact: false });
    api.emit({ type: "closed", roundId: ROUND_A });
    api.emit({
      type: "result",
      roundId: ROUND_A,
      result: { winner: 2, order: ORDER },
      serverSeed: SEED,
    });
    const track = screen.getByTestId("track");
    expect(track.dataset.order).toBe(ORDER.join(","));
    expect(Math.abs(Number(track.dataset.started) - serverNow())).toBeLessThan(2_000);
    expect(screen.queryByText(/Ganador/)).toBeNull();
    expect(statusText()).toContain("La carrera está en curso");
    // The seed is revealed with the result.
    expect(screen.getByText(SEED)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "end-animation" }));
    expect(screen.getByText("Ganador: Zorro")).toBeTruthy();
  });

  it("shows the win from the API payout and refreshes the balance once settled", async () => {
    const api = raceApi(current(openRound()));
    await renderRaces(api.client);
    bet("Zorro", "10");
    await screen.findByText("Apuesta registrada: Zorro, 10 créditos");
    api.emit({ type: "closed", roundId: ROUND_A });
    api.emit({
      type: "result",
      roundId: ROUND_A,
      result: { winner: 2, order: ORDER },
      serverSeed: SEED,
    });

    const settled = { ...resolvedRound(), status: "settled" as const };
    // The payout (4.5x) is whatever the server says; the page never computes it.
    api.setRace(current(settled, { animal: 2, stake: "1000", payout: "4500" }));
    api.setBalance("103500");
    const balanceCalls = api.getBalance.mock.calls.length;
    api.emit({ type: "settled", roundId: ROUND_A });

    expect(await screen.findByText("Cobró 45 créditos (apuesta incluida)")).toBeTruthy();
    expect(screen.getByText("Ganador: Zorro")).toBeTruthy();
    await waitFor(() => expect(api.getBalance.mock.calls.length).toBeGreaterThan(balanceCalls));
    expect((await screen.findAllByText("1,035.00")).length).toBeGreaterThan(0);
  });

  it("shows the loss with the staked amount", async () => {
    const api = raceApi(current(openRound()));
    await renderRaces(api.client);
    bet("Tortuga", "10");
    await screen.findByText("Apuesta registrada: Tortuga, 10 créditos");
    api.emit({
      type: "result",
      roundId: ROUND_A,
      result: { winner: 2, order: ORDER },
      serverSeed: SEED,
    });
    api.setRace(
      current({ ...resolvedRound(), status: "settled" }, { animal: 0, stake: "1000", payout: "0" }),
    );
    api.emit({ type: "settled", roundId: ROUND_A });
    expect(await screen.findByText("Perdió 10 créditos")).toBeTruthy();
  });

  it("tells a player without a bet that they did not play", async () => {
    const api = raceApi(current(openRound()));
    await renderRaces(api.client);
    await screen.findByText("00:25", { exact: false });
    api.emit({
      type: "result",
      roundId: ROUND_A,
      result: { winner: 2, order: ORDER },
      serverSeed: SEED,
    });
    api.emit({ type: "settled", roundId: ROUND_A });
    expect(screen.getByText("No apostó en esta carrera.")).toBeTruthy();
    expect(screen.getByText("Ganador: Zorro")).toBeTruthy();
  });

  it("keeps the outcome until the next round opens, then resets the form", async () => {
    const api = raceApi(current(openRound()));
    await renderRaces(api.client);
    bet("Zorro", "10");
    await screen.findByText("Apuesta registrada: Zorro, 10 créditos");
    api.emit({
      type: "result",
      roundId: ROUND_A,
      result: { winner: 2, order: ORDER },
      serverSeed: SEED,
    });
    api.setRace(
      current(
        { ...resolvedRound(), status: "settled" },
        { animal: 2, stake: "1000", payout: "4500" },
      ),
    );
    api.emit({ type: "settled", roundId: ROUND_A });
    await screen.findByText("Cobró 45 créditos (apuesta incluida)");

    api.emit({ type: "opened", round: openRound(ROUND_B, 29_500) });
    expect(screen.queryByText("Cobró 45 créditos (apuesta incluida)")).toBeNull();
    expect(screen.queryByText(/Apuesta registrada/)).toBeNull();
    expect(screen.getByText("00:30")).toBeTruthy();
    expect(betButton().disabled).toBe(false);
    expect(animalRadio("Zorro").checked).toBe(false);
    expect(screen.getByTestId("track").dataset.order).toBe("");
  });

  it("shows a late joiner the race in progress and the next-round notice", async () => {
    const round = resolvedRound(ROUND_A, 4_000);
    const api = raceApi(current(round));
    await renderRaces(api.client);
    expect(await screen.findByText("Podrá apostar en la siguiente ronda.")).toBeTruthy();
    const track = screen.getByTestId("track");
    expect(track.dataset.order).toBe(ORDER.join(","));
    expect(track.dataset.started).toBe(
      String(Date.parse(round.settlesAt as string) - RACE_DURATION_MS),
    );
    expect(screen.queryByRole("button", { name: "Apostar" })).toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByText(/Ganador/)).toBeNull();
  });

  it("shows the outcome of an already settled round without waiting for the animation", async () => {
    const api = raceApi(
      current({ ...resolvedRound(), status: "settled" }, { animal: 4, stake: "300", payout: "0" }),
    );
    await renderRaces(api.client);
    expect(await screen.findByText("Ganador: Zorro")).toBeTruthy();
    expect(screen.getByText("Perdió 3 créditos")).toBeTruthy();
  });

  it("waits for the next race when there is none and reacts to opened", async () => {
    const api = raceApi(current(null));
    await renderRaces(api.client);
    await waitFor(() => expect(statusText()).toContain("Esperando la siguiente carrera…"));
    expect(screen.queryByRole("radio")).toBeNull();
    api.emit({ type: "opened", round: openRound(ROUND_A, 19_500) });
    expect(screen.getByText("00:20")).toBeTruthy();
    expect(screen.getAllByRole("radio")).toHaveLength(5);
  });

  it("ignores events of an older round", async () => {
    const api = raceApi(current(openRound(ROUND_A)));
    await renderRaces(api.client);
    await screen.findByText("00:25");
    api.emit({ type: "opened", round: openRound(ROUND_B, 29_500) });
    api.emit({ type: "closed", roundId: ROUND_A });
    api.emit({
      type: "result",
      roundId: ROUND_A,
      result: { winner: 2, order: ORDER },
      serverSeed: SEED,
    });
    api.emit({ type: "settled", roundId: ROUND_A });
    expect(statusText()).toContain("Apuestas abiertas");
    expect(screen.getByTestId("track").dataset.order).toBe("");
    expect(betButton().disabled).toBe(false);
    // An "opened" for the round that is already gone does not bring it back.
    api.emit({ type: "opened", round: openRound(ROUND_A, 10_000) });
    expect(screen.getByText("00:30")).toBeTruthy();
  });
});

describe("RacesPage live stream", () => {
  it("fetches the race again on every reconnection", async () => {
    const api = raceApi(current(openRound()));
    await renderRaces(api.client);
    await screen.findByText("00:25");
    const calls = api.getCurrentRace.mock.calls.length;

    api.status("reconnecting");
    expect(screen.getByText("Reconectando…")).toBeTruthy();

    api.setRace(current(resolvedRound()));
    api.status("connected");
    await waitFor(() => expect(api.getCurrentRace.mock.calls.length).toBe(calls + 1));
    expect(screen.queryByText("Reconectando…")).toBeNull();
    await waitFor(() => expect(screen.getByTestId("track").dataset.order).toBe(ORDER.join(",")));
  });

  it("fetches once at mount: the first connection is that fetch", async () => {
    const api = raceApi(current(openRound()));
    await renderRaces(api.client);
    await screen.findByText("00:25");
    expect(api.getCurrentRace).toHaveBeenCalledTimes(1);
  });

  it("fetches when the first connection comes after mount, recovering what was missed", async () => {
    const api = raceApi(current(openRound()), { deferConnect: true });
    await renderRaces(api.client);
    await screen.findByText("00:25");
    expect(api.getCurrentRace).toHaveBeenCalledTimes(1);

    // The round resolved after that answer and before the stream was up: no event reaches us.
    api.setRace(current(resolvedRound()));
    api.status("connected");
    await waitFor(() => expect(api.getCurrentRace).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTestId("track").dataset.order).toBe(ORDER.join(",")));
  });

  it("keeps the page when a refetch fails after a successful load", async () => {
    const api = raceApi(current(openRound()));
    await renderRaces(api.client);
    await screen.findByText("00:25");

    api.getCurrentRace.mockRejectedValueOnce(new Error("offline"));
    api.status("reconnecting");
    api.status("connected");
    await waitFor(() => expect(api.getCurrentRace).toHaveBeenCalledTimes(2));
    await Promise.resolve();
    expect(screen.queryByText("No se pudo cargar la carrera.")).toBeNull();
    expect(screen.getByText("00:25")).toBeTruthy();
    expect(betButton().disabled).toBe(false);
  });

  it("closes the stream and stops its timers on unmount", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const api = raceApi(current(openRound()));
    const view = await renderRaces(api.client);
    await screen.findByText("00:25");
    view.unmount();
    expect(api.unsubscribe).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("RacesPage watchdog for lost events", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

  it("recovers a lost closed event two seconds after closesAt", async () => {
    const api = raceApi(current(openRound(ROUND_A, 3_000)));
    await renderRaces(api.client);
    await screen.findByText("00:03");
    expect(api.getCurrentRace).toHaveBeenCalledTimes(1);

    api.setRace(current({ ...openRound(ROUND_A, -2_000), status: "closed" }));
    await advance(4_000);
    expect(api.getCurrentRace).toHaveBeenCalledTimes(1);
    await advance(2_000);
    await waitFor(() => expect(api.getCurrentRace).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(statusText()).toContain("Apuestas cerradas"));
  });

  it("recovers a lost result and settled pair after settlesAt plus two seconds", async () => {
    const round = resolvedRound(ROUND_A, 3_000);
    const api = raceApi(current(round, { animal: 2, stake: "1000", payout: null }));
    await renderRaces(api.client);
    expect(api.getCurrentRace).toHaveBeenCalledTimes(1);

    api.setRace(
      current({ ...round, status: "settled" }, { animal: 2, stake: "1000", payout: "4500" }),
    );
    await advance(4_000);
    expect(api.getCurrentRace).toHaveBeenCalledTimes(1);
    await advance(2_000);
    await waitFor(() => expect(api.getCurrentRace).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Cobró 45 créditos (apuesta incluida)")).toBeTruthy();
  });

  it("expects a closed round to end after the race duration when settlesAt is unknown", async () => {
    const api = raceApi(
      current({ ...openRound(ROUND_A, -1_000), status: "closed" }, null, { raceDurationMs: 6_000 }),
    );
    await renderRaces(api.client);
    expect(api.getCurrentRace).toHaveBeenCalledTimes(1);
    // closesAt + 6 s + 2 s is 7 s away.
    await advance(6_000);
    expect(api.getCurrentRace).toHaveBeenCalledTimes(1);
    await advance(2_000);
    await waitFor(() => expect(api.getCurrentRace).toHaveBeenCalledTimes(2));
  });

  it("retries every five seconds while the page is still behind", async () => {
    const api = raceApi(current(openRound(ROUND_A, 1_000)));
    await renderRaces(api.client);
    await screen.findByText("00:01");
    // The server keeps answering "open": the closed event never shows up either.
    await advance(3_000);
    await waitFor(() => expect(api.getCurrentRace).toHaveBeenCalledTimes(2));
    await advance(4_000);
    expect(api.getCurrentRace).toHaveBeenCalledTimes(2);
    await advance(1_500);
    await waitFor(() => expect(api.getCurrentRace).toHaveBeenCalledTimes(3));
    await advance(5_000);
    await waitFor(() => expect(api.getCurrentRace).toHaveBeenCalledTimes(4));

    // Once the server moves on, the retries stop.
    api.setRace(current({ ...openRound(ROUND_A, -9_000), status: "closed" }));
    await advance(5_000);
    await waitFor(() => expect(api.getCurrentRace).toHaveBeenCalledTimes(5));
    await waitFor(() => expect(statusText()).toContain("Apuestas cerradas"));
    const calls = api.getCurrentRace.mock.calls.length;
    await advance(4_000);
    expect(api.getCurrentRace.mock.calls.length).toBe(calls);
  });

  it("covers a null snapshot that left a stale open round on screen", async () => {
    const api = raceApi(current(openRound(ROUND_A, 1_000)));
    await renderRaces(api.client);
    await screen.findByText("00:01");
    api.setRace(current(null));
    await advance(3_500);
    await waitFor(() => expect(api.getCurrentRace).toHaveBeenCalledTimes(2));
    await advance(5_000);
    await waitFor(() => expect(api.getCurrentRace).toHaveBeenCalledTimes(3));
  });

  it("never overlaps fetches", async () => {
    const api = raceApi(current(openRound(ROUND_A, 1_000)));
    await renderRaces(api.client);
    await screen.findByText("00:01");
    let calls = 0;
    api.getCurrentRace.mockImplementation(() => {
      calls += 1;
      return new Promise(() => {});
    });
    await advance(30_000);
    expect(calls).toBe(1);
  });

  it("does not fetch extra while the events arrive on time", async () => {
    const api = raceApi(current(openRound(ROUND_A, 3_000)));
    await renderRaces(api.client);
    await screen.findByText("00:03");
    await advance(3_000);
    api.emit({ type: "closed", roundId: ROUND_A });
    await advance(500);
    api.emit({
      type: "result",
      roundId: ROUND_A,
      result: { winner: 2, order: ORDER },
      serverSeed: SEED,
    });
    await advance(RACE_DURATION_MS);
    api.emit({ type: "settled", roundId: ROUND_A });
    await advance(60_000);
    expect(api.getCurrentRace).toHaveBeenCalledTimes(1);
  });

  it("clears its timers on unmount", async () => {
    const api = raceApi(current(openRound(ROUND_A, 3_000)));
    const view = await renderRaces(api.client);
    await screen.findByText("00:03");
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    await advance(30_000);
    expect(api.getCurrentRace).toHaveBeenCalledTimes(1);
  });

  it("does not raise an unhandled rejection when the fetch fails", async () => {
    const api = raceApi(current(openRound(ROUND_A, 1_000)));
    await renderRaces(api.client);
    await screen.findByText("00:01");
    api.getCurrentRace.mockRejectedValue(new Error("offline"));
    await advance(3_500);
    await waitFor(() => expect(api.getCurrentRace).toHaveBeenCalledTimes(2));
    await advance(5_000);
    await waitFor(() => expect(api.getCurrentRace).toHaveBeenCalledTimes(3));
    expect(screen.queryByText("No se pudo cargar la carrera.")).toBeNull();
  });
});

describe("RacesPage with the mock API", () => {
  it("plays a whole round: bet, race, settlement and the next round", async () => {
    const client = createMockApiClient({
      race: { windowMs: 400, durationMs: 300, intermissionMs: 300 },
    });
    await renderRaces(client);
    await screen.findAllByText("1,000.00");
    bet("Guepardo", "5");
    expect(await screen.findByText("Apuesta registrada: Guepardo, 5 créditos")).toBeTruthy();
    expect(screen.getAllByText("995.00").length).toBeGreaterThan(0);
    const outcome = await screen.findByText(
      /^(Cobró 22\.50 créditos \(apuesta incluida\)|Perdió 5 créditos)$/,
      undefined,
      {
        timeout: 3_000,
      },
    );
    const won = outcome.textContent?.startsWith("Cobró");
    await waitFor(() =>
      expect(screen.getAllByText(won ? "1,017.50" : "995.00").length).toBeGreaterThan(0),
    );
    // The next round opens with a fresh form.
    await waitFor(() => expect(betButton().disabled).toBe(false), { timeout: 3_000 });
    expect(screen.queryByText(/Apuesta registrada/)).toBeNull();
  });
});

describe("races route", () => {
  it("is protected: a visitor without a session goes to the login screen", async () => {
    localStorage.clear();
    const api = raceApi(current(openRound()));
    const router = createMemoryRouter(routes, { initialEntries: ["/games/races"] });
    render(<App client={api.client} router={router} />);
    expect(await screen.findByRole("heading", { level: 1, name: "Iniciar sesión" })).toBeTruthy();
    expect(router.state.location.pathname).toBe("/login");
    expect(api.watchRaces).not.toHaveBeenCalled();
  });
});
