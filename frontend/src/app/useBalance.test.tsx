import { cleanup, render, screen, within } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { type ApiClient, createMockApiClient } from "../api";
import { routes } from "./routes";
import { useBalance } from "./useBalance";

afterEach(cleanup);

function renderLobby(client: ApiClient) {
  const router = createMemoryRouter(routes, { initialEntries: ["/"] });
  render(<App client={client} router={router} />);
  return {
    header: screen.getByRole("banner"),
    pick: screen.getByRole("region", { name: "Gira la ruleta" }),
  };
}

describe("balance", () => {
  it("sends one balance request for the header and the lobby", async () => {
    const client = createMockApiClient();
    const getBalance = vi.spyOn(client, "getBalance");
    const { header, pick } = renderLobby(client);
    expect(await within(header).findByText("1,000.00")).toBeTruthy();
    expect(await within(pick).findByText("1,000.00")).toBeTruthy();
    expect(getBalance).toHaveBeenCalledTimes(1);
  });

  it("shows the loading mark in both places while the request is pending", () => {
    const client = createMockApiClient();
    vi.spyOn(client, "getBalance").mockReturnValue(new Promise(() => {}));
    const { header, pick } = renderLobby(client);
    expect(within(header).getByText("…")).toBeTruthy();
    expect(within(pick).getByText("…")).toBeTruthy();
  });

  it("flags the balance as loading until the amount arrives", async () => {
    const { header, pick } = renderLobby(createMockApiClient());
    expect(within(header).getByText("…").hasAttribute("data-loading")).toBe(true);
    expect(within(pick).getByText("…").hasAttribute("data-loading")).toBe(true);
    expect((await within(header).findByText("1,000.00")).hasAttribute("data-loading")).toBe(false);
    expect((await within(pick).findByText("1,000.00")).hasAttribute("data-loading")).toBe(false);
  });

  it("shows the failure mark in both places when the request fails", async () => {
    const client = createMockApiClient();
    vi.spyOn(client, "getBalance").mockRejectedValue(new Error("down"));
    const { header, pick } = renderLobby(client);
    expect(await within(header).findByText("--")).toBeTruthy();
    expect(await within(pick).findByText("--")).toBeTruthy();
  });

  it("throws when used outside a BalanceProvider", () => {
    function Probe() {
      useBalance();
      return null;
    }
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow("useBalance must be used inside a <BalanceProvider>");
    vi.restoreAllMocks();
  });
});
