import { describe, expect, it } from "vitest";
import { shortCredits, signedCredits } from "./money";

describe("shortCredits", () => {
  it("drops the cents of whole credits and keeps them otherwise", () => {
    expect(shortCredits(0n)).toBe("0");
    expect(shortCredits(2500n)).toBe("25");
    expect(shortCredits(1250n)).toBe("12.50");
    expect(shortCredits(123456700n)).toBe("1,234,567");
  });

  it("writes negatives with a minus sign", () => {
    expect(shortCredits(-300n)).toBe("−3");
    expect(shortCredits(-250n)).toBe("−2.50");
  });
});

describe("signedCredits", () => {
  it("marks gains with a plus, losses with a minus and leaves zero bare", () => {
    expect(signedCredits(3600n)).toBe("+36");
    expect(signedCredits(-1000n)).toBe("−10");
    expect(signedCredits(0n)).toBe("0");
  });
});
