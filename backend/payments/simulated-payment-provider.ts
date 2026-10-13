import type { WalletService } from "../wallet/wallet-service";
import type { PaymentProvider } from "./payment-provider";

/**
 * Credits the player from the issuance account (README §2.4). Locking the player's wallet first
 * serializes concurrent retries of one key, so the lookup below cannot race an insert.
 */
export function createSimulatedPaymentProvider(wallet: WalletService): PaymentProvider {
  return {
    name: "simulated",
    async deposit(trx, { userId, amount, idempotencyKey }) {
      await wallet.lockBalance(trx, userId);
      const existing = await wallet.findTransaction(trx, idempotencyKey);
      if (existing) return { transactionId: existing.id };
      return wallet.transfer(trx, {
        from: "issuance",
        to: { userId },
        amount,
        type: "deposit",
        idempotencyKey,
      });
    },
  };
}
