import { NotImplementedError } from "@casino/shared";
import { describe, expect, it } from "vitest";
import type { Db } from "../db/database";
import { stubServices } from "./services";

const db = {} as Db;
const id = "11111111-1111-4111-8111-111111111111";

type Case = readonly [name: string, issue: string, call: () => Promise<unknown>];
const { wallet, payments, seedPairs, tokens } = stubServices;

const cases: Case[] = [
  ["wallet.createPlayerWallet", "#10", () => wallet.createPlayerWallet(db, id)],
  ["wallet.getBalance", "#10", () => wallet.getBalance(db, id)],
  ["wallet.lockBalance", "#10", () => wallet.lockBalance(db, id)],
  [
    "wallet.transfer",
    "#10",
    () =>
      wallet.transfer(db, {
        from: "issuance",
        to: { userId: id },
        amount: 100n,
        type: "deposit",
        idempotencyKey: "deposit:k",
      }),
  ],
  ["wallet.findTransaction", "#10", () => wallet.findTransaction(db, "deposit:k")],
  ["wallet.listTransactions", "#10", () => wallet.listTransactions(db, id, { limit: 10 })],
  [
    "payments.deposit",
    "#10",
    () => payments.deposit(db, { userId: id, amount: 100n, idempotencyKey: "deposit:k" }),
  ],
  ["seedPairs.getActive", "#11", () => seedPairs.getActive(db, id)],
  ["seedPairs.draw", "#11", () => seedPairs.draw(db, id)],
  ["seedPairs.rotate", "#11", () => seedPairs.rotate(db, id)],
  ["tokens.sign", "#9", () => tokens.sign({ id, role: "player" })],
  ["tokens.verify", "#9", () => tokens.verify("token")],
];

describe("stub services", () => {
  it.each(cases)("%s rejects with NotImplementedError naming %s", async (_name, issue, call) => {
    const error = await call().then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(NotImplementedError);
    expect((error as Error).message).toContain(issue);
  });

  it("names the stub payment provider", () => {
    expect(payments.name).toBe("stub");
  });
});
