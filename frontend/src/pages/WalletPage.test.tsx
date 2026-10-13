import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { type ApiClient, ApiError, createMockApiClient } from "../api";
import { routes } from "../app/routes";
import { seedSession } from "../test/session";
import { creditsToAmount } from "./creditsInput";

beforeEach(() => {
  seedSession();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function renderWallet(client: ApiClient) {
  const router = createMemoryRouter(routes, { initialEntries: ["/wallet"] });
  render(<App client={client} router={router} />);
  return {
    header: screen.getByRole("banner"),
    balance: screen.getByRole("region", { name: "Saldo actual" }),
  };
}

async function seedDeposits(client: ApiClient, count: number) {
  for (let i = 1; i <= count; i++) {
    await client.deposit({ amount: String(i * 100) }, `seed-key-${i}`);
  }
}

function submitAmount(text: string) {
  fireEvent.change(screen.getByLabelText("Monto en créditos"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Depositar" }));
}

describe("creditsToAmount", () => {
  it("converts credits to minor units without floats", () => {
    expect(creditsToAmount("12.34")).toBe("1234");
    expect(creditsToAmount("12.3")).toBe("1230");
    expect(creditsToAmount("007")).toBe("700");
    expect(creditsToAmount(" 5 ")).toBe("500");
    expect(creditsToAmount("0.07")).toBe("7");
  });

  it("rejects zero, negatives, extra decimals, non-numeric text and overflow", () => {
    const invalid = ["", "0", "0.00", "-5", "1.234", "abc", "1e3", "1,5", "92233720368547758.08"];
    for (const bad of invalid) {
      expect(creditsToAmount(bad), bad).toBeNull();
    }
  });
});

describe("WalletPage", () => {
  it("shows the balance and the history, newest first", async () => {
    const client = createMockApiClient();
    await seedDeposits(client, 2);
    const { balance } = renderWallet(client);
    expect(await within(balance).findByText("1,003.00")).toBeTruthy();
    const list = await screen.findByRole("list", { name: "Historial de movimientos" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain("+2.00");
    expect(rows[0]?.textContent).toContain("Depósito");
    expect(rows[1]?.textContent).toContain("+1.00");
  });

  it("shows the empty state when there are no movements", async () => {
    renderWallet(createMockApiClient());
    expect(await screen.findByText("Todavía no hay movimientos.")).toBeTruthy();
  });

  it("shows an error when the history cannot be loaded", async () => {
    const client = createMockApiClient();
    vi.spyOn(client, "listTransactions").mockRejectedValue(new ApiError("network", "down", 0));
    renderWallet(client);
    expect(await screen.findByText("No se pudieron cargar los movimientos.")).toBeTruthy();
  });

  it("deposits, then updates the balance, the header chip and the history", async () => {
    const client = createMockApiClient();
    const getBalance = vi.spyOn(client, "getBalance");
    const deposit = vi.spyOn(client, "deposit");
    const { header, balance } = renderWallet(client);
    await within(balance).findByText("1,000.00");
    await screen.findByText("Todavía no hay movimientos.");
    expect(getBalance).toHaveBeenCalledTimes(1);

    submitAmount("12.34");

    expect(await within(balance).findByText("1,012.34")).toBeTruthy();
    expect(within(header).getByText("1,012.34")).toBeTruthy();
    expect(deposit).toHaveBeenCalledWith({ amount: "1234" }, expect.any(String));
    expect(getBalance).toHaveBeenCalledTimes(2);
    const list = await screen.findByRole("list", { name: "Historial de movimientos" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("status").textContent).toContain("Depósito acreditado: 12.34");
  });

  it("uses a quick-pick amount", async () => {
    const client = createMockApiClient();
    const deposit = vi.spyOn(client, "deposit");
    renderWallet(client);
    fireEvent.click(screen.getByRole("button", { name: "1.000" }));
    fireEvent.click(screen.getByRole("button", { name: "Depositar" }));
    await waitFor(() =>
      expect(deposit).toHaveBeenCalledWith({ amount: "100000" }, expect.any(String)),
    );
  });

  it("rejects an invalid amount inline without calling the API", async () => {
    const client = createMockApiClient();
    const deposit = vi.spyOn(client, "deposit");
    renderWallet(client);
    for (const bad of ["", "0", "-3", "abc", "1.234"]) {
      submitAmount(bad);
      expect(await screen.findByText(/mayor que cero, con hasta dos decimales/)).toBeTruthy();
    }
    expect(deposit).not.toHaveBeenCalled();
  });

  it("reuses the Idempotency-Key when retrying the same amount after a network failure", async () => {
    const client = createMockApiClient();
    const deposit = vi.spyOn(client, "deposit");
    deposit.mockRejectedValueOnce(new ApiError("network", "down", 0));
    const { balance } = renderWallet(client);
    await within(balance).findByText("1,000.00");

    submitAmount("5");
    expect(await screen.findByText(/No hay conexión/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Depositar" }));
    await within(balance).findByText("1,005.00");
    const [first, second] = deposit.mock.calls;
    expect(second?.[1]).toBe(first?.[1]);

    submitAmount("6");
    await within(balance).findByText("1,011.00");
    expect(deposit.mock.calls[2]?.[1]).not.toBe(first?.[1]);
  });

  it("uses a new key for a different amount after a network failure", async () => {
    const client = createMockApiClient();
    const deposit = vi.spyOn(client, "deposit");
    deposit.mockRejectedValueOnce(new ApiError("network", "down", 0));
    renderWallet(client);
    submitAmount("5");
    await screen.findByText(/No hay conexión/);
    submitAmount("7");
    await waitFor(() => expect(deposit).toHaveBeenCalledTimes(2));
    expect(deposit.mock.calls[1]?.[1]).not.toBe(deposit.mock.calls[0]?.[1]);
  });

  it("asks to sign in on an unauthorized answer", async () => {
    const client = createMockApiClient();
    vi.spyOn(client, "deposit").mockRejectedValue(new ApiError("unauthorized", "no", 401));
    renderWallet(client);
    submitAmount("5");
    expect(await screen.findByText("Inicie sesión para continuar.")).toBeTruthy();
  });

  it("disables the button while the deposit is pending", async () => {
    const client = createMockApiClient();
    vi.spyOn(client, "deposit").mockReturnValue(new Promise(() => {}));
    renderWallet(client);
    submitAmount("5");
    const button = await screen.findByRole("button", { name: "Depositando…" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("appends the next page with Cargar más", async () => {
    const client = createMockApiClient();
    await seedDeposits(client, 12);
    renderWallet(client);
    const list = await screen.findByRole("list", { name: "Historial de movimientos" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(10);
    fireEvent.click(screen.getByRole("button", { name: "Cargar más" }));
    await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(12));
    expect(screen.queryByRole("button", { name: "Cargar más" })).toBeNull();
    const rows = within(list).getAllByRole("listitem");
    expect(rows[11]?.textContent).toContain("+1.00");
  });
});
