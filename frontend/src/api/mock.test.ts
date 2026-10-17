import {
  authResponseSchema,
  balanceResponseSchema,
  depositResponseSchema,
  pocketColor,
  type RouletteBetRequest,
  rouletteBetResponseSchema,
  transactionHistoryResponseSchema,
} from "@casino/shared";
import { describe, expect, it } from "vitest";
import { readJwtExpiry } from "../session/jwt";
import { createMockApiClient } from "./mock";

const bet: RouletteBetRequest = {
  bets: [{ stake: "500", selection: { type: "color", color: "red" } }],
};

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

  it("logs in a registered account and issues a token with an expiry", async () => {
    const api = createMockApiClient();
    const creds = { email: "Ana@Casino.test", password: "password123" };
    const registered = await api.register(creds);
    expect(registered.user.email).toBe("ana@casino.test");
    const loggedIn = await api.login({ email: "ana@casino.test", password: "password123" });
    expect(loggedIn.user.id).toBe(registered.user.id);
    expect(readJwtExpiry(loggedIn.token)).toBeGreaterThan(Date.now() / 1000);
  });

  it("rejects a duplicate email with a conflict", async () => {
    const api = createMockApiClient();
    const creds = { email: "a@b.co", password: "password123" };
    await api.register(creds);
    await expect(api.register(creds)).rejects.toMatchObject({ code: "conflict", status: 409 });
  });

  it("answers the same unauthorized error for an unknown email and a wrong password", async () => {
    const api = createMockApiClient();
    await api.register({ email: "a@b.co", password: "password123" });
    const wrong = await api.login({ email: "a@b.co", password: "nope-nope" }).catch((e) => e);
    const unknown = await api.login({ email: "x@b.co", password: "password123" }).catch((e) => e);
    expect(wrong).toMatchObject({ code: "unauthorized", status: 401 });
    expect(unknown).toMatchObject({ code: "unauthorized", status: 401 });
    expect(unknown.message).toBe(wrong.message);
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

  it("pays bets with the shared roulette rules and records bet and payout movements", async () => {
    const api = createMockApiClient();
    let balance = 100000n;
    for (let i = 0; i < 20; i++) {
      const res = await api.placeRouletteBet(bet, `key-bet-${i.toString().padStart(4, "0")}`);
      const won = pocketColor(res.result.number) === "red";
      expect(res.payout).toBe(won ? "1000" : "0");
      balance += (won ? 1000n : 0n) - 500n;
      expect(res.balance).toBe(balance.toString());
      expect(res.result.number).toBeGreaterThanOrEqual(0);
      expect(res.result.number).toBeLessThanOrEqual(36);
    }
    const [latest] = (await api.listTransactions({ limit: 1 })).items;
    expect(["bet", "payout"]).toContain(latest?.type);
  });

  it("pays a winning straight bet 36 times the stake", async () => {
    const api = createMockApiClient();
    for (let i = 0; i < 200; i++) {
      const res = await api.placeRouletteBet(
        { bets: [{ stake: "100", selection: { type: "straight", number: 17 } }] },
        `key-straight-${i.toString().padStart(4, "0")}`,
      );
      expect(res.payout).toBe(res.result.number === 17 ? "3600" : "0");
    }
  });

  it("charges once when a bet is retried with the same idempotency key", async () => {
    const api = createMockApiClient();
    const first = await api.placeRouletteBet(bet, "key-00000002");
    const second = await api.placeRouletteBet(bet, "key-00000002");
    expect(second).toEqual(first);
    const bets = (await api.listTransactions()).items.filter((t) => t.type === "bet");
    expect(bets).toHaveLength(1);
  });

  it("settles several selections with one spin and one pair of movements", async () => {
    const api = createMockApiClient();
    const body: RouletteBetRequest = {
      bets: [
        { stake: "100", selection: { type: "straight", number: 17 } },
        { stake: "200", selection: { type: "color", color: "red" } },
        { stake: "300", selection: { type: "dozen", dozen: 2 } },
      ],
    };
    const res = await api.placeRouletteBet(body, "key-multi-0001");
    expect(rouletteBetResponseSchema.safeParse(res).success).toBe(true);
    expect(res.stake).toBe("600");
    expect(res.bets.map((b) => b.stake)).toEqual(["100", "200", "300"]);
    const n = res.result.number;
    const expected = [
      n === 17 ? 3600n : 0n,
      pocketColor(n) === "red" ? 400n : 0n,
      n >= 13 && n <= 24 ? 900n : 0n,
    ];
    expect(res.bets.map((b) => b.payout)).toEqual(expected.map(String));
    const total = expected.reduce((a, b) => a + b, 0n);
    expect(res.payout).toBe(total.toString());
    expect(res.balance).toBe((100000n - 600n + total).toString());
    const moves = (await api.listTransactions()).items;
    expect(moves.filter((t) => t.type === "bet")).toHaveLength(1);
    expect(moves.filter((t) => t.type === "payout")).toHaveLength(total > 0n ? 1 : 0);
  });

  it("rejects an empty or duplicated list and refuses a key reused with another list", async () => {
    const api = createMockApiClient();
    const red: RouletteBetRequest["bets"][number] = {
      stake: "100",
      selection: { type: "color", color: "red" },
    };
    await expect(api.placeRouletteBet({ bets: [] }, "key-multi-0002")).rejects.toMatchObject({
      code: "invalid_request",
    });
    await expect(
      api.placeRouletteBet({ bets: [red, { ...red, stake: "200" }] }, "key-multi-0003"),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await api.placeRouletteBet({ bets: [red] }, "key-multi-0004");
    await expect(
      api.placeRouletteBet({ bets: [{ ...red, stake: "200" }] }, "key-multi-0004"),
    ).rejects.toMatchObject({ code: "conflict", status: 409 });
  });

  it("rejects a bet larger than the balance with insufficient_funds", async () => {
    const api = createMockApiClient();
    await expect(
      api.placeRouletteBet(
        { bets: [{ stake: "100001", selection: { type: "color", color: "red" } }] },
        "key-00000003",
      ),
    ).rejects.toMatchObject({ code: "insufficient_funds", status: 422 });
    expect((await api.getBalance()).balance).toBe("100000");
    expect((await api.listTransactions()).items).toHaveLength(0);
  });

  it("honors the history limit", async () => {
    const api = createMockApiClient();
    for (let i = 1; i <= 3; i++) await api.deposit({ amount: "100" }, `key-0000000${i}`);
    expect((await api.listTransactions({ limit: 2 })).items).toHaveLength(2);
  });
});
