import { type Kysely, sql } from "kysely";

// Race rounds keep their outcome and lifecycle timestamps on the round row, and a user may place
// at most one bet per round. The index is partial so individual games (round_id null) are free.

// biome-ignore lint/suspicious/noExplicitAny: migrations are decoupled from the live schema types
type AnyDb = Kysely<any>;

export async function up(db: AnyDb): Promise<void> {
  await sql`alter table game_rounds
    add column result jsonb,
    add column resolved_at timestamptz,
    add column settled_at timestamptz`.execute(db);
  await sql`create unique index bets_round_user_key on bets (round_id, user_id) where round_id is not null`.execute(
    db,
  );
}

export async function down(db: AnyDb): Promise<void> {
  await sql`drop index bets_round_user_key`.execute(db);
  await sql`alter table game_rounds
    drop column result,
    drop column resolved_at,
    drop column settled_at`.execute(db);
}
