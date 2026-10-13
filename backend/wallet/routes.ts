import {
  apiPaths,
  type BalanceResponse,
  type DepositResponse,
  depositRequestSchema,
  parseAmount,
  type TransactionHistoryResponse,
  toAmount,
  transactionHistoryQuerySchema,
} from "@casino/shared";
import { getAuth } from "../auth/guard";
import { parseWith, readIdempotencyKey } from "../platform/http";
import type { ModuleRoutes } from "../platform/routes";
import { scopedKey } from "./wallet-service";

export const walletRoutes: ModuleRoutes = async (app, { db, services, requireAuth }) => {
  const { wallet, payments } = services;

  app.get(apiPaths.balance, { preHandler: requireAuth() }, async (request) => {
    const balance = await wallet.getBalance(db, getAuth(request).id);
    const body: BalanceResponse = { balance: toAmount(balance) };
    return body;
  });

  app.post(apiPaths.deposits, { preHandler: requireAuth() }, async (request, reply) => {
    const userId = getAuth(request).id;
    const key = readIdempotencyKey(request);
    const { amount } = parseWith(depositRequestSchema, request.body);

    // A retry of one key finds the original transaction and moves no money (README §3.3).
    const body = await db.transaction().execute(async (trx): Promise<DepositResponse> => {
      const { transactionId } = await payments.deposit(trx, {
        userId,
        amount: parseAmount(amount),
        idempotencyKey: scopedKey("deposit", userId, key),
      });
      const balance = await wallet.getBalance(trx, userId);
      return { transactionId, balance: toAmount(balance) };
    });
    return reply.code(201).send(body);
  });

  app.get(apiPaths.transactions, { preHandler: requireAuth() }, async (request) => {
    const { limit, cursor } = parseWith(transactionHistoryQuerySchema, request.query);
    const page = await wallet.listTransactions(db, getAuth(request).id, { limit, cursor });
    const body: TransactionHistoryResponse = {
      items: page.items.map((record) => ({
        id: record.id,
        type: record.type,
        amount: toAmount(record.amount),
        betId: record.betId,
        createdAt: record.createdAt.toISOString(),
      })),
      nextCursor: page.nextCursor,
    };
    return body;
  });
};
