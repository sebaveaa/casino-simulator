import { type Kysely, sql } from "kysely";

// Blackjack (#63): a player has at most one hand in progress. `bets_game_check` already accepts
// 'blackjack' (0001, kept by 0004), so only the partial unique index is new; settled hands and other games are
// free.

// biome-ignore lint/suspicious/noExplicitAny: migrations are decoupled from the live schema types
type AnyDb = Kysely<any>;

export async function up(db: AnyDb): Promise<void> {
  await sql`create unique index bets_one_blackjack_in_progress_key on bets (user_id) where game = 'blackjack' and status = 'in_progress'`.execute(
    db,
  );
}

export async function down(db: AnyDb): Promise<void> {
  await sql`drop index bets_one_blackjack_in_progress_key`.execute(db);
}
