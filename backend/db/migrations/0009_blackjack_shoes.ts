import { type Kysely, sql } from "kysely";

// Blackjack's continuous shoe (#66). A shoe takes one nonce from the player's seed pair when it
// opens and lasts across hands until the cut card; its order is recomputed from the seeds, never
// stored. Each hand records its shoe and the offset of its first card, and shares the shoe's seed
// pair and nonce (a composite foreign key keeps the copy exact), so the unique (seed_pair_id,
// nonce) on bets now holds only for bets without a shoe. Hands from before keep shoe_id = null:
// their own shoe at offset 0.

// biome-ignore lint/suspicious/noExplicitAny: migrations are decoupled from the live schema types
type AnyDb = Kysely<any>;

export async function up(db: AnyDb): Promise<void> {
  await sql`
    create table blackjack_shoes (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references users (id),
      seed_pair_id uuid not null references seed_pairs (id),
      nonce integer not null,
      cut_card smallint not null,
      next_card smallint not null default 0,
      status text not null default 'active',
      end_reason text,
      created_at timestamptz not null default now(),
      finished_at timestamptz,
      constraint blackjack_shoes_cut_card_check check (cut_card > 0 and cut_card <= 312),
      constraint blackjack_shoes_next_card_check check (next_card >= 0 and next_card <= 312),
      constraint blackjack_shoes_status_check check (status in ('active', 'finished')),
      constraint blackjack_shoes_end_reason_check check (end_reason in ('cut_card', 'seed_rotated')),
      constraint blackjack_shoes_finished_check check (
        (status = 'finished') = (finished_at is not null)
        and (status = 'finished') = (end_reason is not null)
      ),
      constraint blackjack_shoes_seed_pair_nonce_key unique (seed_pair_id, nonce),
      constraint blackjack_shoes_seed_key unique (id, seed_pair_id, nonce)
    )
  `.execute(db);
  await sql`create unique index blackjack_shoes_one_active_key on blackjack_shoes (user_id) where status = 'active'`.execute(
    db,
  );

  await sql`alter table bets add column shoe_id uuid, add column card_offset smallint`.execute(db);
  await sql`
    alter table bets
      add constraint bets_shoe_check check (
        (shoe_id is null) = (card_offset is null) and (shoe_id is null or game = 'blackjack')
      ),
      add constraint bets_card_offset_check check (card_offset >= 0),
      add constraint bets_shoe_fkey foreign key (shoe_id, seed_pair_id, nonce)
        references blackjack_shoes (id, seed_pair_id, nonce),
      add constraint bets_shoe_card_key unique (shoe_id, card_offset)
  `.execute(db);
  await sql`alter table bets drop constraint bets_seed_pair_nonce_key`.execute(db);
  await sql`create unique index bets_seed_pair_nonce_key on bets (seed_pair_id, nonce) where shoe_id is null`.execute(
    db,
  );
}

export async function down(db: AnyDb): Promise<void> {
  await sql`drop index bets_seed_pair_nonce_key`.execute(db);
  await sql`
    alter table bets
      drop constraint bets_shoe_card_key,
      drop constraint bets_shoe_fkey,
      drop constraint bets_card_offset_check,
      drop constraint bets_shoe_check,
      drop column card_offset,
      drop column shoe_id
  `.execute(db);
  // Fails while hands of one shoe share a nonce: drop them first on a database that has any.
  await sql`alter table bets add constraint bets_seed_pair_nonce_key unique (seed_pair_id, nonce)`.execute(
    db,
  );
  await sql`drop table blackjack_shoes`.execute(db);
}
