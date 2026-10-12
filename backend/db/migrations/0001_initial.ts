import { type Kysely, sql } from "kysely";

// Initial schema (README §3.4) plus the ledger guards (§3.1). The migration keeps one SQL
// statement per call, and the generic `Kysely<any>` is deliberate: a migration must not
// depend on the current `Database` types, which change after it ships.

// biome-ignore lint/suspicious/noExplicitAny: migrations are decoupled from the live schema types
type AnyDb = Kysely<any>;

export async function up(db: AnyDb): Promise<void> {
  await db.schema
    .createTable("users")
    .addColumn("id", "uuid", (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("email", "text", (c) => c.notNull().unique())
    .addColumn("password_hash", "text", (c) => c.notNull())
    .addColumn("role", "text", (c) => c.notNull().defaultTo("player"))
    .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .addCheckConstraint("users_role_check", sql`role in ('player', 'admin')`)
    .execute();

  await db.schema
    .createTable("wallets")
    .addColumn("id", "uuid", (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("user_id", "uuid", (c) => c.unique().references("users.id"))
    .addColumn("kind", "text", (c) => c.notNull())
    .addColumn("balance", "bigint", (c) => c.notNull().defaultTo(0))
    .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .addCheckConstraint("wallets_kind_check", sql`kind in ('player', 'house', 'issuance')`)
    .addCheckConstraint("wallets_owner_check", sql`(kind = 'player') = (user_id is not null)`)
    .addCheckConstraint("wallets_player_balance_check", sql`kind <> 'player' or balance >= 0`)
    .execute();

  // One wallet per system account.
  await sql`create unique index wallets_system_kind_key on wallets (kind) where user_id is null`.execute(
    db,
  );

  await db.schema
    .createTable("seed_pairs")
    .addColumn("id", "uuid", (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("user_id", "uuid", (c) => c.notNull().references("users.id"))
    .addColumn("server_seed", "text", (c) => c.notNull())
    .addColumn("server_seed_hash", "text", (c) => c.notNull())
    .addColumn("client_seed", "text", (c) => c.notNull())
    .addColumn("next_nonce", "integer", (c) => c.notNull().defaultTo(0))
    .addColumn("revealed_at", "timestamptz")
    .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .addCheckConstraint("seed_pairs_next_nonce_check", sql`next_nonce >= 0`)
    .execute();

  // One active (not yet revealed) pair per user.
  await sql`create unique index seed_pairs_active_key on seed_pairs (user_id) where revealed_at is null`.execute(
    db,
  );

  await db.schema
    .createTable("game_rounds")
    .addColumn("id", "uuid", (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("game", "text", (c) => c.notNull())
    .addColumn("status", "text", (c) => c.notNull())
    .addColumn("server_seed", "text", (c) => c.notNull())
    .addColumn("server_seed_hash", "text", (c) => c.notNull())
    .addColumn("opens_at", "timestamptz", (c) => c.notNull())
    .addColumn("closes_at", "timestamptz", (c) => c.notNull())
    .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .addCheckConstraint(
      "game_rounds_status_check",
      sql`status in ('open', 'closed', 'resolved', 'settled')`,
    )
    .addCheckConstraint("game_rounds_window_check", sql`closes_at > opens_at`)
    .execute();

  await db.schema
    .createTable("bets")
    .addColumn("id", "uuid", (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("user_id", "uuid", (c) => c.notNull().references("users.id"))
    .addColumn("game", "text", (c) => c.notNull())
    .addColumn("round_id", "uuid", (c) => c.references("game_rounds.id"))
    .addColumn("seed_pair_id", "uuid", (c) => c.references("seed_pairs.id"))
    .addColumn("nonce", "integer")
    .addColumn("stake", "bigint", (c) => c.notNull())
    .addColumn("selection", "jsonb", (c) => c.notNull())
    .addColumn("actions", "jsonb")
    .addColumn("result", "jsonb")
    .addColumn("payout", "bigint")
    .addColumn("status", "text", (c) => c.notNull())
    .addColumn("settled_at", "timestamptz")
    .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .addCheckConstraint("bets_game_check", sql`game in ('roulette', 'slots', 'races', 'blackjack')`)
    .addCheckConstraint("bets_stake_check", sql`stake > 0`)
    .addCheckConstraint("bets_payout_check", sql`payout >= 0`)
    .addCheckConstraint("bets_status_check", sql`status in ('pending', 'in_progress', 'settled')`)
    // A bet belongs to a race round or to a seed pair, never both and never neither.
    .addCheckConstraint("bets_source_check", sql`(round_id is null) <> (seed_pair_id is null)`)
    .addCheckConstraint("bets_nonce_check", sql`(seed_pair_id is null) = (nonce is null)`)
    .addUniqueConstraint("bets_seed_pair_nonce_key", ["seed_pair_id", "nonce"])
    .execute();

  await sql`create index bets_user_created_idx on bets (user_id, created_at desc)`.execute(db);
  await db.schema.createIndex("bets_round_idx").on("bets").column("round_id").execute();

  await db.schema
    .createTable("transactions")
    .addColumn("id", "uuid", (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("idempotency_key", "text", (c) => c.notNull().unique())
    .addColumn("type", "text", (c) => c.notNull())
    .addColumn("bet_id", "uuid", (c) => c.references("bets.id"))
    .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .addCheckConstraint(
      "transactions_type_check",
      sql`type in ('deposit', 'withdrawal', 'bet', 'payout')`,
    )
    .execute();

  await db.schema.createIndex("transactions_bet_idx").on("transactions").column("bet_id").execute();

  await db.schema
    .createTable("ledger_entries")
    .addColumn("id", "uuid", (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("transaction_id", "uuid", (c) => c.notNull().references("transactions.id"))
    .addColumn("wallet_id", "uuid", (c) => c.notNull().references("wallets.id"))
    .addColumn("amount", "bigint", (c) => c.notNull())
    .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    // Positive amounts increase the wallet balance.
    .addCheckConstraint("ledger_entries_amount_check", sql`amount <> 0`)
    .execute();

  await sql`create index ledger_entries_wallet_created_idx on ledger_entries (wallet_id, created_at desc)`.execute(
    db,
  );
  await db.schema
    .createIndex("ledger_entries_transaction_idx")
    .on("ledger_entries")
    .column("transaction_id")
    .execute();

  // Append-only: the ledger is never edited; a correction is a new transaction.
  await sql`
    create function ledger_reject_change() returns trigger language plpgsql as $$
    begin
      raise exception '% is append-only', TG_TABLE_NAME;
    end;
    $$`.execute(db);
  await sql`create trigger ledger_entries_append_only before update or delete on ledger_entries for each row execute function ledger_reject_change()`.execute(
    db,
  );
  await sql`create trigger transactions_append_only before update or delete on transactions for each row execute function ledger_reject_change()`.execute(
    db,
  );

  // Double entry: the entries of a transaction sum to zero, checked at commit.
  await sql`
    create function ledger_check_zero_sum() returns trigger language plpgsql as $$
    declare
      total numeric;
    begin
      select coalesce(sum(amount), 0) into total
        from ledger_entries where transaction_id = new.transaction_id;
      if total <> 0 then
        raise exception 'transaction % is unbalanced: entries sum to %', new.transaction_id, total;
      end if;
      return null;
    end;
    $$`.execute(db);
  await sql`create constraint trigger ledger_entries_zero_sum after insert on ledger_entries deferrable initially deferred for each row execute function ledger_check_zero_sum()`.execute(
    db,
  );

  // A transaction has at least two entries, checked at commit.
  await sql`
    create function ledger_check_entry_count() returns trigger language plpgsql as $$
    begin
      if (select count(*) from ledger_entries where transaction_id = new.id) < 2 then
        raise exception 'transaction % needs at least two ledger entries', new.id;
      end if;
      return null;
    end;
    $$`.execute(db);
  await sql`create constraint trigger transactions_min_entries after insert on transactions deferrable initially deferred for each row execute function ledger_check_entry_count()`.execute(
    db,
  );

  // System accounts (README §3.1).
  await sql`insert into wallets (kind, balance) values ('issuance', 0)`.execute(db);
  await sql`insert into wallets (kind, balance) values ('house', 0)`.execute(db);
}

export async function down(db: AnyDb): Promise<void> {
  await sql`drop trigger transactions_min_entries on transactions`.execute(db);
  await sql`drop function ledger_check_entry_count()`.execute(db);
  await sql`drop trigger ledger_entries_zero_sum on ledger_entries`.execute(db);
  await sql`drop function ledger_check_zero_sum()`.execute(db);
  await sql`drop trigger transactions_append_only on transactions`.execute(db);
  await sql`drop trigger ledger_entries_append_only on ledger_entries`.execute(db);
  await sql`drop function ledger_reject_change()`.execute(db);
  await db.schema.dropTable("ledger_entries").execute();
  await db.schema.dropTable("transactions").execute();
  await db.schema.dropTable("bets").execute();
  await db.schema.dropTable("game_rounds").execute();
  await db.schema.dropTable("seed_pairs").execute();
  await db.schema.dropTable("wallets").execute();
  await db.schema.dropTable("users").execute();
}
