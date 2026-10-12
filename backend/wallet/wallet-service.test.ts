import { describe, expect, it } from "vitest";
import { InsufficientFundsError, scopedKey } from "./wallet-service";

describe("scopedKey", () => {
  it("joins purpose, user and client key", () => {
    expect(scopedKey("deposit", "user-1", "abc12345")).toBe("deposit:user-1:abc12345");
  });

  it("gives different users different keys for the same client key", () => {
    expect(scopedKey("roulette-bet", "u1", "k")).not.toBe(scopedKey("roulette-bet", "u2", "k"));
  });
});

describe("InsufficientFundsError", () => {
  it("is a 422 insufficient_funds AppError", () => {
    const error = new InsufficientFundsError();
    expect(error.code).toBe("insufficient_funds");
    expect(error.statusCode).toBe(422);
  });
});
