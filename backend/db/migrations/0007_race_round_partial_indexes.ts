import { type Kysely, sql } from "kysely";

// 0004's `(game, status, opens_at desc)` could only serve the `game` prefix of the round lookups:
// both ask for "status <> 'settled'" or "status = 'settled'", which is not an equality on one
// status, so PostgreSQL filtered and sorted. One partial index per question lets each read the
// newest row straight from the index:
//  - the current round: the newest round that is not settled (`getCurrentRound`, and the worker's
//    check for an active round);
//  - the intermission: the latest settlement of the game (`getCurrentRound`, the worker's reopen).
// The queries spell the predicates exactly as written here, which is how the planner proves them.

// biome-ignore lint/suspicious/noExplicitAny: migrations are decoupled from the live schema types
type AnyDb = Kysely<any>;

export async function up(db: AnyDb): Promise<void> {
  await sql`drop index game_rounds_current_idx`.execute(db);
  await sql`create index game_rounds_open_idx on game_rounds (game, opens_at desc) where status <> 'settled'`.execute(
    db,
  );
  await sql`create index game_rounds_settled_idx on game_rounds (game, settled_at desc) where status = 'settled'`.execute(
    db,
  );
}

export async function down(db: AnyDb): Promise<void> {
  await sql`drop index game_rounds_settled_idx`.execute(db);
  await sql`drop index game_rounds_open_idx`.execute(db);
  await sql`create index game_rounds_current_idx on game_rounds (game, status, opens_at desc)`.execute(
    db,
  );
}
