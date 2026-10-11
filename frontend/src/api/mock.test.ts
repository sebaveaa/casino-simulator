import {
  authResponseSchema,
  balanceResponseSchema,
  depositResponseSchema,
  rouletteBetResponseSchema,
  transactionHistoryResponseSchema,
} from "@casino/shared";
import { describe, expect, it } from "vitest";
import { createMockApiClient } from "./mock";

const bet = { stake: "500", selection: { type: "color", color: "red" } } as const;

describe("mock API client", () => {
  it("returns responses that satisfy the shared schemas", async () => {
    const api = createMockApiClient();
    const creds = { email: "a@b.co", password: "password123" };
    expect(authResponseSchema.safeParse(await api.register(creds)).success).toBe(true);
    expect(authResponseSchema.safeParse(await api.login(creds)).success).toBe(true);
    expect(balanceResponseSchema.safeParse(await api.getBalance()).success).toBe(true);
    expect(
      depositResponseSchema.safeParse(await api.deposit({ amount: "100" }, "key-00000001")).success,
    ).toBe(true);
    expect(
      rouletteBetResponseSchema.safeParse(await api.placeRouletteBet(bet, "key-00000002")).success,
    ).toBe(true);
    expect(transactionHistoryResponseSchema.safeParse(await api.listTransactions()).success).toBe(
      true,
    );
  });

  it("starts with 1,000.00 credits and deposits increase the balance", async () => {
    const api = createMockApiClient();
    expect((await api.getBalance()).balance).toBe("100000");
    const res = await api.deposit({ amount: "2500" }, "key-00000001");
    expect(res.balance).toBe("102500");
    expect((await api.getBalance()).balance).toBe("102500");
  });

  it("moves money once for a repeated idempotency key", async () => {
    const api = createMockApiClient();
    const first = await api.deposit({ amount: "2500" }, "key-00000001");
    const second = await api.deposit({ amount: "2500" }, "key-00000001");
    expect(second).toEqual(first);
    expect((await api.getBalance()).balance).toBe("102500");
    expect((await api.listTransactions()).items).toHaveLength(1);
  });

  it("charges the stake for a bet and lists it first", async () => {
    const api = createMockApiClient();
    await api.deposit({ amount: "100" }, "key-00000001");
    const res = await api.placeRouletteBet(bet, "key-00000002");
    expect(res.balance).toBe("99600");
    expect(res.payout).toBe("0");
    expect(res.result.number).toBeGreaterThanOrEqual(0);
    expect(res.result.number).toBeLessThanOrEqual(36);
    const [latest] = (await api.listTransactions()).items;
    expect(latest?.type).toBe("bet");
    expect(latest?.amount).toBe("-500");
    expect(latest?.betId).toBe(res.betId);
  });

  it("honors the history limit", async () => {
    const api = createMockApiClient();
    for (let i = 1; i <= 3; i++) await api.deposit({ amount: "100" }, `key-0000000${i}`);
    expect((await api.listTransactions({ limit: 2 })).items).toHaveLength(2);
  });
});
