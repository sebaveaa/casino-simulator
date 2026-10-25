import { type Kysely, sql } from "kysely";

// Mini games (PLAN-MINI-GAMES §4): bets accept the three new games, and a player has at most one
// Chicken Road game in progress. The index is partial, so settled games and other games are free.

// biome-ignore lint/suspicious/noExplicitAny: migrations are decoupled from the live schema types
type AnyDb = Kysely<any>;

export async function up(db: AnyDb): Promise<void> {
  await sql`alter table bets drop constraint bets_game_check`.execute(db);
  await sql`alter table bets add constraint bets_game_check check (game in ('roulette', 'slots', 'races', 'blackjack', 'chicken-road', 'dino-crash', 'aviator'))`.execute(
    db,
  );
  await sql`create unique index bets_one_chicken_road_in_progress_key on bets (user_id) where game = 'chicken-road' and status = 'in_progress'`.execute(
    db,
  );
}

export async function down(db: AnyDb): Promise<void> {
  await sql`drop index bets_one_chicken_road_in_progress_key`.execute(db);
  await sql`alter table bets drop constraint bets_game_check`.execute(db);
  await sql`alter table bets add constraint bets_game_check check (game in ('roulette', 'slots', 'races', 'blackjack'))`.execute(
    db,
  );
}
