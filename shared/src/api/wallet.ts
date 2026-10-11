import { z } from "zod";
import { amountSchema, positiveAmountSchema, signedAmountSchema } from "../money";

export const balanceResponseSchema = z.object({ balance: amountSchema });
export type BalanceResponse = z.infer<typeof balanceResponseSchema>;

export const depositRequestSchema = z.object({ amount: positiveAmountSchema });
export type DepositRequest = z.infer<typeof depositRequestSchema>;

export const depositResponseSchema = z.object({
  transactionId: z.uuid(),
  balance: amountSchema,
});
export type DepositResponse = z.infer<typeof depositResponseSchema>;

export const transactionTypeSchema = z.enum(["deposit", "withdrawal", "bet", "payout"]);
export type TransactionType = z.infer<typeof transactionTypeSchema>;

export const transactionSchema = z.object({
  id: z.uuid(),
  type: transactionTypeSchema,
  /** Net change of the player's wallet: negative for a stake, positive for a payout. */
  amount: signedAmountSchema,
  betId: z.uuid().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type Transaction = z.infer<typeof transactionSchema>;

/** Query string of the history endpoint; `cursor` is opaque and comes from `nextCursor`. */
export const transactionHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
});
/** What the client sends (every field optional). */
export type TransactionHistoryQueryInput = z.input<typeof transactionHistoryQuerySchema>;
/** What the server sees after defaults and coercion. */
export type TransactionHistoryQuery = z.infer<typeof transactionHistoryQuerySchema>;

export const transactionHistoryResponseSchema = z.object({
  items: z.array(transactionSchema),
  nextCursor: z.string().nullable(),
});
export type TransactionHistoryResponse = z.infer<typeof transactionHistoryResponseSchema>;
