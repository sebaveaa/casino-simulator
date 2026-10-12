import type { Money, TransactionType } from "@casino/shared";
import type { Db } from "../db/database";
import { AppError } from "../platform/errors";

/** The two non-player accounts seeded by the initial migration (README §3.1). */
export type SystemAccount = "house" | "issuance";
export type Account = { userId: string } | SystemAccount;

/** One ledger transaction with two entries: `-amount` on `from`, `+amount` on `to`. */
export type TransferInput = {
  from: Account;
  to: Account;
  /** Positive, in minor units. */
  amount: Money;
  type: TransactionType;
  /** Stored as is in `transactions.idempotency_key`; build it with {@link scopedKey}. */
  idempotencyKey: string;
  betId?: string;
};

export type TransactionRecord = {
  id: string;
  type: TransactionType;
  /** Net change of the player's wallet: negative for a stake, positive for a payout. */
  amount: Money;
  betId: string | null;
  createdAt: Date;
};

export type TransactionPage = {
  items: TransactionRecord[];
  /** Opaque; pass it back as `cursor` to get the next page. `null` on the last page. */
  nextCursor: string | null;
};

/**
 * The only module that moves money (README §2.3, §3). Every method takes the Kysely executor,
 * so a bet runs inside its caller's single `BEGIN … COMMIT` (README §3.2). Implemented by #10.
 */
export interface WalletService {
  /** Creates the player's wallet with a zero balance. Called at registration. */
  createPlayerWallet(db: Db, userId: string): Promise<void>;

  /** Current balance of the player's wallet. */
  getBalance(db: Db, userId: string): Promise<Money>;

  /**
   * Locks the player's wallet row (`SELECT … FOR UPDATE`) and returns its balance. Call it first
   * in a bet transaction, so concurrent bets of one player serialize.
   */
  lockBalance(trx: Db, userId: string): Promise<Money>;

  /**
   * Writes one transaction with two ledger entries and keeps `wallets.balance` in sync.
   * Throws {@link InsufficientFundsError} if a player wallet would go negative. A repeated
   * `idempotencyKey` is rejected by the unique constraint; check {@link findTransaction} first.
   */
  transfer(trx: Db, input: TransferInput): Promise<{ transactionId: string }>;

  /**
   * Looks a transaction up by its stored idempotency key, so a retry can return the original
   * result instead of charging again (README §3.3).
   */
  findTransaction(
    db: Db,
    idempotencyKey: string,
  ): Promise<{ id: string; betId: string | null } | undefined>;

  /** The player's transactions, newest first, paged by an opaque cursor. */
  listTransactions(
    db: Db,
    userId: string,
    page: { limit: number; cursor?: string },
  ): Promise<TransactionPage>;
}

/** A player wallet would go negative (HTTP 422). */
export class InsufficientFundsError extends AppError {
  constructor(message = "Insufficient funds") {
    super("insufficient_funds", message);
    this.name = "InsufficientFundsError";
  }
}

/**
 * `transactions.idempotency_key` is globally unique, so the client's key is scoped by purpose
 * and user before it is stored. Purposes: `deposit`, `roulette-bet`, `roulette-payout`.
 */
export function scopedKey(purpose: string, userId: string, key: string): string {
  return `${purpose}:${userId}:${key}`;
}
