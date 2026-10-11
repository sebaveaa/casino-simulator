import type { Money } from "@casino/shared";
import type { Db } from "../db/database";

export type DepositInput = {
  userId: string;
  /** Positive, in minor units. */
  amount: Money;
  /** Already scoped with `scopedKey("deposit", ...)`. */
  idempotencyKey: string;
};

/**
 * Where fictitious credits come from (README §2.4). A deposit credits the player from the
 * issuance account through `WalletService`. The simulated provider is #10; withdrawals come later.
 */
export interface PaymentProvider {
  readonly name: string;
  deposit(trx: Db, input: DepositInput): Promise<{ transactionId: string }>;
}
