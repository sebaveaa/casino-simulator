import { formatCredits, type Money } from "@casino/shared";

/** Credits for compact displays: "25" for whole credits, "12.50" otherwise, "−3" when negative. */
export function shortCredits(minor: Money): string {
  if (minor < 0n) return `−${shortCredits(-minor)}`;
  const text = formatCredits(minor);
  return minor % 100n === 0n ? text.slice(0, -3) : text;
}

/** Like `shortCredits` with an explicit "+" on gains; zero has no sign. */
export function signedCredits(minor: Money): string {
  return minor > 0n ? `+${shortCredits(minor)}` : shortCredits(minor);
}
