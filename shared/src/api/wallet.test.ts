import { describe, expect, it } from "vitest";
import {
  balanceResponseSchema,
  depositRequestSchema,
  depositResponseSchema,
  transactionHistoryQuerySchema,
  transactionHistoryResponseSchema,
  transactionSchema,
} from "./wallet";

const uuid = "123e4567-e89b-42d3-a456-426614174000";
const transaction = {
  id: uuid,
  type: "bet",
  amount: "-100",
  betId: uuid,
  createdAt: "2026-10-11T16:54:10.123+02:00",
};

describe("balance and deposit", () => {
  it("accepts a balance and a positive deposit", () => {
    expect(balanceResponseSchema.safeParse({ balance: "0" }).success).toBe(true);
    expect(depositRequestSchema.safeParse({ amount: "500" }).success).toBe(true);
    expect(depositResponseSchema.safeParse({ transactionId: uuid, balance: "500" }).success).toBe(
      true,
    );
  });

  it("rejects zero, negative and numeric deposits and a bad transaction id", () => {
    for (const amount of ["0", "-5", 5]) {
      expect(depositRequestSchema.safeParse({ amount }).success).toBe(false);
    }
    expect(depositResponseSchema.safeParse({ transactionId: "x", balance: "1" }).success).toBe(
      false,
    );
  });
});

describe("transactionSchema", () => {
  it("accepts a signed amount, a null betId and a datetime with offset", () => {
    expect(transactionSchema.safeParse(transaction).success).toBe(true);
    expect(
      transactionSchema.safeParse({
        ...transaction,
        betId: null,
        createdAt: "2026-10-11T14:00:00Z",
      }).success,
    ).toBe(true);
  });

  it("rejects an unknown type and a non-datetime", () => {
    expect(transactionSchema.safeParse({ ...transaction, type: "refund" }).success).toBe(false);
    expect(transactionSchema.safeParse({ ...transaction, createdAt: "yesterday" }).success).toBe(
      false,
    );
  });
});

describe("transactionHistoryQuerySchema", () => {
  it("defaults the limit to 20 and coerces strings", () => {
    expect(transactionHistoryQuerySchema.parse({}).limit).toBe(20);
    expect(transactionHistoryQuerySchema.parse({ limit: "50" }).limit).toBe(50);
  });

  it("rejects limits outside 1..100 and an empty cursor", () => {
    for (const limit of ["0", "101"]) {
      expect(transactionHistoryQuerySchema.safeParse({ limit }).success).toBe(false);
    }
    expect(transactionHistoryQuerySchema.safeParse({ cursor: "" }).success).toBe(false);
  });
});

describe("transactionHistoryResponseSchema", () => {
  it("accepts a page with and without a next cursor", () => {
    const page = { items: [transaction], nextCursor: null };
    expect(transactionHistoryResponseSchema.safeParse(page).success).toBe(true);
    expect(transactionHistoryResponseSchema.safeParse({ ...page, nextCursor: "abc" }).success).toBe(
      true,
    );
  });
});
