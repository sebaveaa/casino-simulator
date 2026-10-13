import type { Money, TransactionType } from "@casino/shared";
import { sql } from "kysely";
import type { Db } from "../db/database";
import { AppError } from "../platform/errors";
import {
  type Account,
  InsufficientFundsError,
  type TransactionPage,
  type TransactionRecord,
  type TransferInput,
  type WalletService,
} from "./wallet-service";

const MAX_PAGE_SIZE = 100;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Microsecond precision, as stored: a millisecond cursor would skip or repeat entries.
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

type Cursor = { createdAt: string; id: string };

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeCursor(value: string): Cursor {
  const invalid = new AppError("invalid_request", "Invalid cursor");
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw invalid;
  }
  if (typeof parsed !== "object" || parsed === null) throw invalid;
  const { createdAt, id } = parsed as Record<string, unknown>;
  if (
    typeof createdAt !== "string" ||
    typeof id !== "string" ||
    !TIMESTAMP_PATTERN.test(createdAt) ||
    !UUID_PATTERN.test(id)
  ) {
    throw invalid;
  }
  return { createdAt, id };
}

function notFound(): AppError {
  return new AppError("not_found", "Wallet not found");
}

/** Id of the wallet behind an account: the player's by owner, a system one by kind. */
async function resolveWalletId(db: Db, account: Account): Promise<string> {
  const query = db.selectFrom("wallets").select("id");
  const row =
    typeof account === "string"
      ? await query.where("kind", "=", account).where("user_id", "is", null).executeTakeFirst()
      : await query.where("user_id", "=", account.userId).executeTakeFirst();
  if (!row) throw notFound();
  return row.id;
}

async function updateBalance(trx: Db, walletId: string, delta: Money): Promise<void> {
  await trx
    .updateTable("wallets")
    .set({ balance: sql<bigint>`balance + ${delta}` })
    .where("id", "=", walletId)
    .execute();
}

/** PostgreSQL implementation of the double-entry ledger (README §3). */
export const postgresWalletService: WalletService = {
  async createPlayerWallet(db, userId) {
    await db
      .insertInto("wallets")
      .values({ user_id: userId, kind: "player", balance: 0n })
      .execute();
  },

  async getBalance(db, userId) {
    const row = await db
      .selectFrom("wallets")
      .select("balance")
      .where("user_id", "=", userId)
      .executeTakeFirst();
    if (!row) throw notFound();
    return row.balance;
  },

  async lockBalance(trx, userId) {
    const row = await trx
      .selectFrom("wallets")
      .select("balance")
      .where("user_id", "=", userId)
      .forUpdate()
      .executeTakeFirst();
    if (!row) throw notFound();
    return row.balance;
  },

  async transfer(trx, input: TransferInput) {
    if (input.amount <= 0n) throw new AppError("invalid_request", "Amount must be positive");

    const fromId = await resolveWalletId(trx, input.from);
    const toId = await resolveWalletId(trx, input.to);
    if (fromId === toId) {
      throw new AppError("invalid_request", "Cannot transfer to the same wallet");
    }

    // Ascending id order, so opposite transfers between two wallets cannot deadlock.
    const locked = await trx
      .selectFrom("wallets")
      .select(["id", "kind", "balance"])
      .where("id", "in", [fromId, toId])
      .orderBy("id")
      .forUpdate()
      .execute();
    const from = locked.find((wallet) => wallet.id === fromId);
    if (!from) throw notFound();
    if (from.kind === "player" && from.balance < input.amount) throw new InsufficientFundsError();

    const { id: transactionId } = await trx
      .insertInto("transactions")
      .values({
        idempotency_key: input.idempotencyKey,
        type: input.type,
        bet_id: input.betId ?? null,
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    await trx
      .insertInto("ledger_entries")
      .values([
        { transaction_id: transactionId, wallet_id: fromId, amount: -input.amount },
        { transaction_id: transactionId, wallet_id: toId, amount: input.amount },
      ])
      .execute();

    await updateBalance(trx, fromId, -input.amount);
    await updateBalance(trx, toId, input.amount);
    return { transactionId };
  },

  async findTransaction(db, idempotencyKey) {
    const row = await db
      .selectFrom("transactions")
      .select(["id", "bet_id"])
      .where("idempotency_key", "=", idempotencyKey)
      .executeTakeFirst();
    return row ? { id: row.id, betId: row.bet_id } : undefined;
  },

  async listTransactions(db, userId, page): Promise<TransactionPage> {
    const limit = Math.min(Math.max(Math.trunc(page.limit), 1), MAX_PAGE_SIZE);
    const cursor = page.cursor === undefined ? undefined : decodeCursor(page.cursor);

    let query = db
      .selectFrom("ledger_entries as e")
      .innerJoin("wallets as w", "w.id", "e.wallet_id")
      .innerJoin("transactions as t", "t.id", "e.transaction_id")
      .select([
        "e.id as entryId",
        "e.amount",
        "e.created_at as createdAt",
        sql<string>`to_char(e.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as(
          "cursorTime",
        ),
        "t.id as transactionId",
        "t.type",
        "t.bet_id as betId",
      ])
      .where("w.user_id", "=", userId)
      .orderBy("e.created_at", "desc")
      .orderBy("e.id", "desc")
      .limit(limit + 1);
    if (cursor) {
      query = query.where(
        sql<boolean>`(e.created_at, e.id) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`,
      );
    }

    const rows = await query.execute();
    const pageRows = rows.slice(0, limit);
    const last = pageRows.at(-1);
    const items: TransactionRecord[] = pageRows.map((row) => ({
      id: row.transactionId,
      type: row.type as TransactionType,
      amount: row.amount,
      betId: row.betId,
      createdAt: row.createdAt,
    }));
    const nextCursor =
      rows.length > limit && last
        ? encodeCursor({ createdAt: last.cursorTime, id: last.entryId })
        : null;
    return { items, nextCursor };
  },
};
