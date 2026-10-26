import { BLACKJACK_RANKS, type BlackjackRank } from "@casino/shared";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { type ApiClient, ApiError, createMockApiClient } from "../api";
import { routes } from "../app/routes";
import { seedSession } from "../test/session";
import { ALREADY_IN_PROGRESS } from "./blackjack/useBlackjack";

const PATH = "/games/blackjack";

// Each test plays a whole hand through the UI; under full-suite load that can pass 5 s.
vi.setConfig({ testTimeout: 15_000 });

/** jsdom has no `matchMedia`; without it motion is on and each deal waits for its cards. */
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

/** A stacked shoe of spades: player, dealer, player, dealer, then the draws. */
const shoe = (...ranks: BlackjackRank[]) => ranks.map((rank) => BLACKJACK_RANKS.indexOf(rank));

// Player K+7 (17) against a dealer 9 up: the turn stays open.
const OPEN = shoe("K", "9", "7", "8", "2", "3", "4");
// Player 5+6 against 9+8: a hit or a double draws the K for 21.
const ELEVEN = shoe("5", "9", "6", "8", "K", "K");
// Player 19 against 6+5: the dealer draws 3 and 4 to 18, so a stand wins.
const STAND_WINS = shoe("K", "6", "9", "5", "3", "4");

/** The mock with fixed shoes plus overrides. */
function client(
  shoes: number[][] = [],
  overrides: (base: ApiClient) => Partial<ApiClient> = () => ({}),
  startingBalance?: bigint,
): ApiClient {
  const base = createMockApiClient({ blackjackShoes: shoes, startingBalance });
  return { ...base, ...overrides(base) };
}

const panel = () => screen.getByRole("complementary", { name: "Tu mano" });
const table = () => screen.getByRole("region", { name: "Mesa" });
const inPanel = (name: string | RegExp) => within(panel()).getByRole("button", { name });
const alertText = () => within(panel()).queryByRole("alert")?.textContent ?? null;
const result = () => screen.getByRole("dialog");
const inResult = (text: string | RegExp) => within(result()).getByText(text);

/** The cards of one hand, as a screen reader names them. */
const cardsOf = (who: "Banca" | "Tú" | "Mano 1" | "Mano 2") =>
  within(within(table()).getByRole("list", { name: who }))
    .getAllByRole("listitem")
    .map((card) => card.getAttribute("aria-label"));

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

const deal = () => press(/^Repartir/);

/** The header chip shows the shared balance. */
const headerBalance = (text: string) => screen.findAllByText(text, {}, { timeout: 4000 });

describe("BlackjackPage bet form", () => {
  it("shows the title, an empty table and the bet form with how hands pay", async () => {
    await renderPage(client());
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Blackjack");
    expect(within(table()).getAllByText("Esperando el reparto")).toHaveLength(2);
    expect(inPanel("Repartir · 10 créditos")).toBeTruthy();
    expect(within(panel()).getByText("3:2")).toBeTruthy();
    expect(within(panel()).getByText("Partida verificable")).toBeTruthy();
  });

  it("disables Repartir for a stake outside 10 to 500 credits", async () => {
    await renderPage(client());
    fireEvent.change(within(panel()).getByLabelText("Tu apuesta"), { target: { value: "5" } });
    expect((inPanel(/^Repartir/) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(panel()).getByRole("button", { name: "500" }));
    expect(inPanel("Repartir · 500 créditos")).toBeTruthy();
  });
});

describe("BlackjackPage hand", () => {
  it("deals the player's cards and only the dealer's up card, and charges the stake", async () => {
    await renderPage(client([OPEN]));
    await deal();
    expect(cardsOf("Tú")).toEqual(["K de picas", "7 de picas"]);
    expect(cardsOf("Banca")).toEqual(["9 de picas", "Carta oculta"]);
    expect(within(panel()).getByText("17")).toBeTruthy();
    expect((inPanel(/^Doblar/) as HTMLButtonElement).disabled).toBe(false);
    expect(await headerBalance("990.00")).toBeTruthy();
  });

  it("stands, reveals the dealer's cards and pays a win", async () => {
    await renderPage(client([STAND_WINS]));
    await deal();
    await press("Plantarse");
    expect(inResult("¡Ganaste!")).toBeTruthy();
    expect(inResult("Ganaste 10 créditos")).toBeTruthy();
    expect(inResult("Cobras 20 créditos")).toBeTruthy();
    expect(cardsOf("Banca")).toEqual(["6 de picas", "5 de picas", "3 de picas", "4 de picas"]);
    expect(inResult("19 contra 18 de la banca")).toBeTruthy();
    expect(within(table()).getByText("+10")).toBeTruthy();
    expect(await headerBalance("1,010.00")).toBeTruthy();
  });

  it("keeps the turn after a hit, and allows a double only on the first two cards", async () => {
    await renderPage(client([OPEN]));
    await deal();
    await press("Pedir");
    expect(cardsOf("Tú")).toHaveLength(3);
    expect((inPanel(/^Doblar/) as HTMLButtonElement).disabled).toBe(true);
    expect(
      within(panel()).getByText("Solo puedes doblar o separar con tus dos primeras cartas."),
    ).toBeTruthy();
  });

  it("doubles: one more card, the stake twice, and the doubled payout", async () => {
    await renderPage(client([ELEVEN]));
    await deal();
    await press(/^Doblar/);
    expect(cardsOf("Tú")).toEqual(["5 de picas", "6 de picas", "K de picas"]);
    expect(inResult("¡Ganaste!")).toBeTruthy();
    expect(inResult(/Apuesta doblada/)).toBeTruthy();
    expect(inResult("Cobras 40 créditos")).toBeTruthy();
    expect(await headerBalance("1,020.00")).toBeTruthy();
  });

  it("shows a bust without the dealer drawing", async () => {
    await renderPage(client([shoe("K", "9", "6", "5", "K", "K")]));
    await deal();
    await press("Pedir");
    expect(inResult("Te pasaste")).toBeTruthy();
    expect(inResult("Perdiste 10 créditos")).toBeTruthy();
    expect(inResult("Sumaste más de 21.")).toBeTruthy();
    expect(cardsOf("Banca")).toEqual(["9 de picas", "5 de picas"]);
    expect(within(table()).getByText("Te pasaste −10")).toBeTruthy();
  });

  it("settles a natural on the deal and a push on equal totals", async () => {
    await renderPage(client([shoe("A", "9", "K", "8"), shoe("K", "K", "8", "8")]));
    await deal();
    expect(inResult("¡Blackjack!")).toBeTruthy();
    expect(inResult("Cobras 25 créditos")).toBeTruthy();

    fireEvent.click(within(result()).getByRole("button", { name: "Jugar otra vez" }));
    await deal();
    await press("Plantarse");
    expect(inResult("Empate")).toBeTruthy();
    expect(inResult("Recuperas 10 créditos")).toBeTruthy();
  });

  it("restores a hand in progress after a reload", async () => {
    const api = client([OPEN]);
    await api.startBlackjackHand({ stake: "5000" }, crypto.randomUUID());
    await renderPage(api);
    expect(inPanel("Pedir")).toBeTruthy();
    expect(cardsOf("Tú")).toEqual(["K de picas", "7 de picas"]);
    expect(within(panel()).getByText("50 créditos")).toBeTruthy();
  });
});

describe("BlackjackPage errors", () => {
  it("does not offer a double the balance cannot cover", async () => {
    await renderPage(client([ELEVEN], undefined, 1500n));
    await deal();
    expect((inPanel(/^Doblar/) as HTMLButtonElement).disabled).toBe(true);
    expect(within(panel()).getByText("No tienes saldo para doblar ni separar.")).toBeTruthy();
  });

  it("keeps the hand and explains a 422 on double", async () => {
    const api = client([ELEVEN], () => ({
      playBlackjackAction: async () => {
        throw new ApiError("insufficient_funds", "Insufficient funds", 422);
      },
    }));
    await renderPage(api);
    await deal();
    await press(/^Doblar/);
    expect(alertText()).toBe("Saldo insuficiente.");
    expect(inPanel("Pedir")).toBeTruthy();
  });

  it("shows the hand's real result when an action answers 409", async () => {
    const api = client([STAND_WINS], (base) => ({
      // Another tab already stood on this hand.
      playBlackjackAction: async (body) => {
        await base.playBlackjackAction({ ...body, action: "stand" });
        throw new ApiError("conflict", "conflict", 409);
      },
    }));
    await renderPage(api);
    await deal();
    await press("Pedir");
    expect(inResult("¡Ganaste!")).toBeTruthy();
    expect(alertText()).toBeNull();
  });

  it("restores the hand in progress when a start answers 409", async () => {
    const api = client([OPEN], (base) => ({
      startBlackjackHand: async (body, key) => {
        await base.startBlackjackHand(body, key);
        throw new ApiError("conflict", "conflict", 409);
      },
    }));
    await renderPage(api);
    await deal();
    expect(alertText()).toBe(ALREADY_IN_PROGRESS);
    expect(inPanel("Pedir")).toBeTruthy();
  });
});

describe("BlackjackPage result pop-up and deal", () => {
  it("closes with Ver la mesa and keeps Jugar otra vez in the panel", async () => {
    await renderPage(client([STAND_WINS]));
    await deal();
    await press("Plantarse");
    fireEvent.click(within(result()).getByRole("button", { name: "Ver la mesa" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(within(panel()).getByText("Mano terminada · ¡Ganaste!")).toBeTruthy();
    await press("Jugar otra vez");
    expect(inPanel(/^Repartir/)).toBeTruthy();
  });

  it("waits for the cards to land before the result and the balance", async () => {
    setReducedMotion(false);
    await renderPage(client([STAND_WINS]));
    await deal();
    fireEvent.click(inPanel("Plantarse"));
    // The dealer's hole card and two draws are still landing: no result, no payout yet.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(panel().getAttribute("aria-busy")).toBe("true");
    expect(await screen.findByRole("dialog", {}, { timeout: 4000 })).toBeTruthy();
    expect(await headerBalance("1,010.00")).toBeTruthy();
  });

  it("shows what a lost hand cost in the history", async () => {
    await renderPage(client([shoe("K", "K", "7", "8", "5")]));
    await deal();
    await press("Plantarse");
    expect(inResult("Perdiste")).toBeTruthy();
    expect(within(table()).getByText("Perdiste −10")).toBeTruthy();
  });
});

describe("BlackjackPage split", () => {
  // 8+8 against 9+7: the left hand draws a 3 (11), the right one a K (18); the dealer draws a 2
  // to 18. Left loses, right pushes.
  const PAIR = shoe("8", "9", "8", "7", "3", "K", "2");

  it("offers Separar only on a pair", async () => {
    await renderPage(client([OPEN, PAIR]));
    await deal();
    expect((inPanel(/^Separar/) as HTMLButtonElement).disabled).toBe(true);
    await press("Plantarse");
    fireEvent.click(within(result()).getByRole("button", { name: "Jugar otra vez" }));
    await deal();
    expect((inPanel(/^Separar/) as HTMLButtonElement).disabled).toBe(false);
    expect(within(panel()).getByText("Tienes un par: puedes separarlo en dos manos.")).toBeTruthy();
  });

  it("splits any two ten-value cards, like a J and a 10", async () => {
    await renderPage(client([shoe("J", "9", "10", "7")]));
    await deal();
    expect((inPanel(/^Separar/) as HTMLButtonElement).disabled).toBe(false);
  });

  it("splits into two hands, plays them in turn and shows each result", async () => {
    await renderPage(client([PAIR]));
    await deal();
    await press(/^Separar/);
    expect(cardsOf("Mano 1")).toEqual(["8 de picas", "3 de picas"]);
    expect(cardsOf("Mano 2")).toEqual(["8 de picas"]);
    expect(within(panel()).getByText("Tu turno · Mano 1 de 2")).toBeTruthy();
    expect(await headerBalance("980.00")).toBeTruthy();

    await press("Plantarse");
    expect(cardsOf("Mano 2")).toEqual(["8 de picas", "K de picas"]);
    expect(within(panel()).getByText("Tu turno · Mano 2 de 2")).toBeTruthy();

    await press("Plantarse");
    expect(inResult("Perdiste")).toBeTruthy();
    expect(inResult("Perdiste 10 créditos")).toBeTruthy();
    expect(inResult("Mano 1: Perdiste")).toBeTruthy();
    expect(inResult("Mano 2: Empate")).toBeTruthy();
    expect(within(table()).getByText("Perdiste −10")).toBeTruthy();
    expect(await headerBalance("990.00")).toBeTruthy();
  });
});
