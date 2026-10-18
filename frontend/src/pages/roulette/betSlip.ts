import {
  type Money,
  POCKET_COUNT,
  parseAmount,
  type RouletteBet,
  type RouletteBetRequest,
  type RouletteBetResponse,
  type RouletteSelection,
  selectionKey,
  spinPayouts,
  toAmount,
} from "@casino/shared";

/** One chip the player dropped on the table; the list keeps click order so Deshacer can pop it. */
export type Chip = { selection: RouletteSelection; amount: Money };

/*
 * The bet slip is a list of chips. These functions never mutate it: each returns the next list,
 * and the table state in the page is just that list.
 */

export function placeChip(
  chips: readonly Chip[],
  selection: RouletteSelection,
  amount: Money,
): Chip[] {
  return [...chips, { selection, amount }];
}

/** Takes back the last chip placed. */
export function undoChip(chips: readonly Chip[]): Chip[] {
  return chips.slice(0, -1);
}

/** Doubles every chip, so every stack doubles too. */
export function doubleChips(chips: readonly Chip[]): Chip[] {
  return chips.map((chip) => ({ ...chip, amount: chip.amount * 2n }));
}

/** One chip per bet, carrying its whole stake: how Repetir re-places a previous spin. */
export function chipsFromBets(bets: readonly RouletteBet[]): Chip[] {
  return bets.map((bet) => ({ selection: bet.selection, amount: bet.stake }));
}

/**
 * Chips stacked by selection: one bet per distinct selection, with the sum of its chips.
 * Bets come in the order their selection was first chosen, which is the order sent to the API.
 */
export function stacksOf(chips: readonly Chip[]): RouletteBet[] {
  const stacks = new Map<string, RouletteBet>();
  for (const chip of chips) {
    const key = selectionKey(chip.selection);
    const stack = stacks.get(key);
    stacks.set(key, {
      selection: chip.selection,
      stake: (stack?.stake ?? 0n) + chip.amount,
    });
  }
  return [...stacks.values()];
}

/** Largest total returned (stake included) over the 37 pockets; 0 for an empty slip. */
export function maxWin(bets: readonly RouletteBet[]): Money {
  let best = 0n;
  for (let number = 0; number < POCKET_COUNT; number++) {
    const { total } = spinPayouts(bets, { number });
    if (total > best) best = total;
  }
  return best;
}

/** The API request for a slip: amounts as strings, bets in the order given. */
export function toRequest(bets: readonly RouletteBet[]): RouletteBetRequest {
  return {
    bets: bets.map(({ stake, selection }) => ({ stake: toAmount(stake), selection })),
  };
}

/** The bets of a response with their stakes back as bigint. */
export function betsFromResponse(bets: RouletteBetResponse["bets"]): RouletteBet[] {
  return bets.map(({ stake, selection }) => ({ stake: parseAmount(stake), selection }));
}
