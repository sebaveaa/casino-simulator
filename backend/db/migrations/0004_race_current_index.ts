import { type Kysely, sql } from "kysely";

// `getCurrentRound` looks up the latest round of a game by status, newest first, on every poll of
// the lobby; this index serves it without scanning every round.

// biome-ignore lint/suspicious/noExplicitAny: migrations are decoupled from the live schema types
type AnyDb = Kysely<any>;

export async function up(db: AnyDb): Promise<void> {
  await sql`create index game_rounds_current_idx on game_rounds (game, status, opens_at desc)`.execute(
    db,
  );
}

export async function down(db: AnyDb): Promise<void> {
  await sql`drop index game_rounds_current_idx`.execute(db);
}
