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
  shoeDealt?: number,
): ApiClient {
  const base = createMockApiClient({
    blackjackShoes: shoes,
    startingBalance,
    blackjackShoeDealt: shoeDealt,
  });
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

/** The history pills: as a screen reader hears them, or as they read on screen without that. */
const pillItems = () =>
  within(table())
    .getAllByRole("listitem")
    .filter((item) => item.classList.contains("cr-history-pill"));
const spokenPills = () => pillItems().map((pill) => pill.textContent);
const historyPills = () =>
  pillItems().map((pill) => {
    const copy = pill.cloneNode(true) as HTMLElement;
    for (const hidden of copy.querySelectorAll(".roulette-sr-only")) hidden.remove();
    return copy.textContent;
  });

/** The shoe's meter on the felt, and how many cards it says are left. */
const shoeMeter = () => table().querySelector("meter") as HTMLMeterElement;
const shoeLeft = () => Number(shoeMeter().getAttribute("value"));

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
    expect(within(table()).getByText("La banca espera")).toBeTruthy();
    expect(within(table()).getByText("Listo para repartir")).toBeTruthy();
    expect(inPanel("Repartir · 10 créditos")).toBeTruthy();
    expect(within(panel()).getByText("3:2")).toBeTruthy();
    expect(within(panel()).getByText("Partida verificable")).toBeTruthy();
  });

  it("adds a chip per click, and takes back the last one or all of them", async () => {
    await renderPage(client());
    await press("Ficha de 50 créditos");
    await press("Ficha de 100 créditos");
    expect(inPanel("Repartir · 160 créditos")).toBeTruthy();
    expect(within(panel()).getByText("160 créditos")).toBeTruthy();
    await press("Deshacer la última ficha");
    expect(inPanel("Repartir · 60 créditos")).toBeTruthy();
    await press("Borrar la apuesta");
    expect((inPanel("Repartir") as HTMLButtonElement).disabled).toBe(true);
    expect(within(panel()).getByText("Toca una ficha para apostar")).toBeTruthy();
    expect(within(table()).getByText("Pon tus fichas y reparte")).toBeTruthy();
  });

  it("piles the chips as they were put down, and a click on them takes back the top one", async () => {
    await renderPage(client());
    await press("Ficha de 50 créditos");
    await press("Ficha de 50 créditos");
    // Two 50s and the 10 stay three chips; they are not stacked as a 100 and a 10.
    const spot = panel().querySelector(".bj-bet-spot") as HTMLElement;
    expect(spot.querySelectorAll(".bj-chip.is-50")).toHaveLength(2);
    expect(spot.querySelectorAll(".bj-chip.is-100")).toHaveLength(0);
    // The same chips sit next to "Tú" on the felt, and a click there takes one back too.
    fireEvent.click(
      within(table()).getByRole("button", { name: "Quitar la ficha de 50 créditos" }),
    );
    expect(inPanel("Repartir · 60 créditos")).toBeTruthy();
    await press("Quitar la ficha de 50 créditos");
    expect(inPanel("Repartir · 10 créditos")).toBeTruthy();
  });

  it("starts a new pile every ten chips", async () => {
    await renderPage(client());
    for (let i = 0; i < 10; i++) await press("Ficha de 10 créditos");
    const piles = [...panel().querySelectorAll(".bj-bet-spot .bj-pile")];
    expect(piles.map((pile) => pile.children.length)).toEqual([10, 1]);
  });

  it("picks a free card back from Mazos and keeps it; a priced one shows its price, locked", async () => {
    await renderPage(client());
    fireEvent.click(within(table()).getByRole("button", { name: "Mazos" }));
    const picker = within(screen.getByRole("dialog", { name: "Mazos" }));
    expect(picker.getByRole("button", { name: /Clásico/ }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    const gold = picker.getByRole("button", { name: /Oro/ }) as HTMLButtonElement;
    expect(gold.disabled).toBe(true);
    expect(gold.textContent).toContain("500 créditos");
    fireEvent.click(picker.getByRole("button", { name: /Lila/ }));
    expect(picker.getByRole("button", { name: /Lila/ }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(picker.getByRole("button", { name: "Listo" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(table().querySelector(".bj-felt-wrap.bj-back-lila")).toBeTruthy();
    expect(localStorage.getItem("casino.blackjack.deck")).toBe("lila");
  });

  it("shows how much of the shoe is dealt, with the cut card, and no button to shuffle", async () => {
    await renderPage(client([OPEN]));
    expect(shoeLeft()).toBe(312);
    await deal();
    // Two cards each, the hole card counted.
    expect(shoeLeft()).toBe(308);
    expect(within(table()).queryByRole("button", { name: "Barajar" })).toBeNull();
  });

  it("shuffles once the cut card is out, when the result closes, holding the table meanwhile", async () => {
    // The shoe starts on the last card before the cut: this hand passes it.
    await renderPage(client([STAND_WINS], undefined, undefined, 233));
    await deal();
    await press("Plantarse");
    expect(shoeMeter().getAttribute("aria-label")).toMatch(/salió la carta de corte/);
    fireEvent.click(within(result()).getByRole("button", { name: "Ver la mesa" }));
    expect(within(table()).getByRole("status").textContent).toBe("Barajando el zapato…");
    expect((inPanel(/^Repetir apuesta/) as HTMLButtonElement).disabled).toBe(true);
    await waitFor(() => expect(screen.queryByText("Barajando el zapato…")).toBeNull(), {
      timeout: 3000,
    });
    // A new shoe: full again, and the table is free.
    expect(shoeLeft()).toBe(312);
    expect((inPanel(/^Repetir apuesta/) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shuffles before dealing again when Repetir apuesta follows the cut", async () => {
    await renderPage(client([STAND_WINS, OPEN], undefined, undefined, 233));
    await deal();
    await press("Plantarse");
    fireEvent.click(within(result()).getByRole("button", { name: /^Repetir apuesta/ }));
    expect(within(table()).getByRole("status").textContent).toBe("Barajando el zapato…");
    expect(
      await within(panel()).findByRole("button", { name: "Pedir" }, { timeout: 4000 }),
    ).toBeTruthy();
    expect(shoeLeft()).toBe(308);
  });

  it("keeps the bet within 500 credits and the balance", async () => {
    await renderPage(client([], undefined, 20000n));
    await press("Borrar la apuesta");
    // A 200-credit balance: the 500 chip is off, and so is a third 100.
    expect((inPanel("Ficha de 500 créditos") as HTMLButtonElement).disabled).toBe(true);
    await press("Ficha de 100 créditos");
    await press("Ficha de 100 créditos");
    expect((inPanel("Ficha de 10 créditos") as HTMLButtonElement).disabled).toBe(true);
    expect(inPanel("Repartir · 200 créditos")).toBeTruthy();
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

    // Repetir apuesta deals the next hand at once.
    fireEvent.click(
      within(result()).getByRole("button", { name: "Repetir apuesta · 10 créditos" }),
    );
    await settled();
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
  it("closes with Ver la mesa and keeps Repetir apuesta and Cambiar apuesta in the panel", async () => {
    await renderPage(client([STAND_WINS]));
    await deal();
    await press("Plantarse");
    fireEvent.click(within(result()).getByRole("button", { name: "Ver la mesa" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(within(panel()).getByText("Mano terminada · ¡Ganaste!")).toBeTruthy();
    expect(inPanel("Repetir apuesta · 10 créditos")).toBeTruthy();
    await press("Cambiar apuesta");
    expect(inPanel("Repartir · 10 créditos")).toBeTruthy();
  });

  it("repeats the round's stake, and goes back to the chips to change it", async () => {
    await renderPage(client([OPEN, OPEN]));
    await press("Ficha de 50 créditos");
    await deal();
    await press("Plantarse");
    fireEvent.click(
      within(result()).getByRole("button", { name: "Repetir apuesta · 60 créditos" }),
    );
    await settled();
    expect(inPanel("Pedir")).toBeTruthy();
    expect(within(panel()).getByText("60 créditos")).toBeTruthy();
    await press("Plantarse");
    fireEvent.click(within(result()).getByRole("button", { name: "Cambiar apuesta" }));
    expect(inPanel("Repartir · 60 créditos")).toBeTruthy();
  });

  it("does not offer to repeat a stake the balance cannot cover", async () => {
    await renderPage(client([shoe("K", "K", "7", "8", "5")], undefined, 1000n));
    await deal();
    await press("Plantarse");
    expect(within(result()).queryByRole("button", { name: /^Repetir apuesta/ })).toBeNull();
    expect(inResult("No tienes saldo para repetir la apuesta.")).toBeTruthy();
  });

  it("clears the chips at the bet form when the balance no longer covers them", async () => {
    // 60 credits on the table with 60 in the wallet: the loss leaves nothing.
    const lose = shoe("K", "K", "7", "8", "5");
    await renderPage(client([lose], undefined, 6000n));
    await press("Ficha de 50 créditos");
    await deal();
    await press("Plantarse");
    fireEvent.click(within(result()).getByRole("button", { name: "Cambiar apuesta" }));
    expect(within(panel()).getByText("Toca una ficha para apostar")).toBeTruthy();
    expect((inPanel("Repartir") as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps the chips when the balance still covers them", async () => {
    await renderPage(client([shoe("K", "K", "7", "8", "5")]));
    await deal();
    await press("Plantarse");
    fireEvent.click(within(result()).getByRole("button", { name: "Cambiar apuesta" }));
    expect(inPanel("Repartir · 10 créditos")).toBeTruthy();
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
    // On screen the tomato pill says only the cost; a screen reader hears "Perdiste −10".
    expect(historyPills()).toEqual(["−10"]);
    expect(spokenPills()).toEqual(["Perdiste −10"]);
  });

  it("names a dealer's natural in the history as Blackjack, and a bust as Te pasaste", async () => {
    // Player K+7 against A+K: the dealer's natural settles on the deal.
    await renderPage(client([shoe("K", "A", "7", "K"), shoe("K", "9", "6", "5", "K", "K")]));
    await deal();
    expect(inResult("Blackjack de la banca")).toBeTruthy();
    fireEvent.click(within(result()).getByRole("button", { name: /^Repetir apuesta/ }));
    await settled();
    await press("Pedir");
    expect(historyPills()).toEqual(["Te pasaste −10", "Blackjack −10"]);
    expect(spokenPills()).toEqual(["Te pasaste −10", "Blackjack de la banca −10"]);
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
    fireEvent.click(
      within(result()).getByRole("button", { name: "Repetir apuesta · 10 créditos" }),
    );
    await settled();
    expect((inPanel(/^Separar/) as HTMLButtonElement).disabled).toBe(false);
    expect(within(panel()).getByText("Tienes un par: puedes separarlo en dos manos.")).toBeTruthy();
  });

  it("splits any two ten-value cards, like a J and a 10", async () => {
    await renderPage(client([shoe("J", "9", "10", "7")]));
    await deal();
    expect((inPanel(/^Separar/) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows each hand's chips next to it, twice on a doubled hand", async () => {
    await renderPage(client([PAIR]));
    await deal();
    await press(/^Separar/);
    const hands = table().querySelectorAll(".bj-player-hands .bj-hand");
    expect([...hands].map((hand) => hand.querySelectorAll(".bj-chip").length)).toEqual([1, 1]);
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
    expect(historyPills()).toEqual(["−10"]);
    expect(await headerBalance("990.00")).toBeTruthy();
  });
});
