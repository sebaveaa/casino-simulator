import { type Kysely, sql } from "kysely";

// Keyset paging of a wallet's history orders by (created_at desc, id desc). The new index
// covers the tie-breaker and makes the 0001 index on (wallet_id, created_at desc) redundant.

// biome-ignore lint/suspicious/noExplicitAny: migrations are decoupled from the live schema types
type AnyDb = Kysely<any>;

export async function up(db: AnyDb): Promise<void> {
  await sql`create index ledger_entries_wallet_history_idx on ledger_entries (wallet_id, created_at desc, id desc)`.execute(
    db,
  );
  await sql`drop index ledger_entries_wallet_created_idx`.execute(db);
}

export async function down(db: AnyDb): Promise<void> {
  await sql`create index ledger_entries_wallet_created_idx on ledger_entries (wallet_id, created_at desc)`.execute(
    db,
  );
  await sql`drop index ledger_entries_wallet_history_idx`.execute(db);
}
