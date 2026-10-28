import type { ColumnType, Generated, Insertable, Selectable, Updateable } from "kysely";

/**
 * A value stored in a `jsonb` column. Only JSON-safe values: `JSON.stringify` throws on
 * `bigint`, so amounts inside jsonb travel as decimal strings, never as `BigInt`.
 */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** `timestamptz` column filled by the database default: read as `Date`, optional on insert. */
type CreatedAt = ColumnType<Date, Date | string | undefined, never>;

/**
 * `bigint` columns are `bigint` in code. The pg pool parses `int8` to `BigInt`
 * (see `createPostgresPool`), and pg serializes `BigInt` parameters as text.
 */
type Bigint = ColumnType<bigint, bigint, bigint>;

export type UserRole = "player" | "admin";
export type WalletKind = "player" | "house" | "issuance";
export type RoundStatus = "open" | "closed" | "resolved" | "settled";
export type BetGame =
  | "roulette"
  | "slots"
  | "races"
  | "blackjack"
  | "chicken-road"
  | "dino-crash"
  | "aviator";
export type BetStatus = "pending" | "in_progress" | "settled";
export type TransactionType = "deposit" | "withdrawal" | "bet" | "payout";

export interface UsersTable {
  id: Generated<string>;
  email: string;
  password_hash: string;
  role: Generated<UserRole>;
  created_at: CreatedAt;
}

export interface WalletsTable {
  id: Generated<string>;
  /** Null for the system accounts (`house`, `issuance`). */
  user_id: string | null;
  kind: WalletKind;
  /** Cache of the ledger sum, maintained by WalletService. */
  balance: ColumnType<bigint, bigint | undefined, bigint>;
  created_at: CreatedAt;
}

export interface SeedPairsTable {
  id: Generated<string>;
  user_id: string;
  server_seed: string;
  server_seed_hash: string;
  client_seed: string;
  next_nonce: Generated<number>;
  /** Null while the pair is active. */
  revealed_at: Date | null;
  created_at: CreatedAt;
}

export interface GameRoundsTable {
  id: Generated<string>;
  game: string;
  status: RoundStatus;
  server_seed: string;
  server_seed_hash: string;
  opens_at: Date;
  closes_at: Date;
  /** Race outcome, set when the round is resolved. */
  result: Json | null;
  resolved_at: Date | null;
  settled_at: Date | null;
  created_at: CreatedAt;
}

export interface BetsTable {
  id: Generated<string>;
  user_id: string;
  game: BetGame;
  /** Set for race bets; exclusive with `seed_pair_id`. */
  round_id: string | null;
  /** Set for individual games; exclusive with `round_id`. */
  seed_pair_id: string | null;
  nonce: number | null;
  stake: Bigint;
  selection: Json;
  /** Blackjack decisions; Chicken Road lanes attempted. */
  actions: Json | null;
  /** Blackjack: the shoe the hand is dealt from (null for hands from before #66). */
  shoe_id: ColumnType<string | null, string | null | undefined, string | null>;
  /** Blackjack: the place of the hand's first card in its shoe; set with `shoe_id`. */
  card_offset: ColumnType<number | null, number | null | undefined, number | null>;
  result: Json | null;
  payout: ColumnType<bigint | null, bigint | null | undefined, bigint | null>;
  status: BetStatus;
  settled_at: Date | null;
  created_at: CreatedAt;
}

export interface TransactionsTable {
  id: Generated<string>;
  /** Globally unique; callers store a scoped key (user and purpose). */
  idempotency_key: string;
  type: TransactionType;
  bet_id: string | null;
  created_at: CreatedAt;
}

export interface LedgerEntriesTable {
  id: Generated<string>;
  transaction_id: string;
  wallet_id: string;
  /** Positive increases the wallet balance. Never zero. */
  amount: Bigint;
  created_at: CreatedAt;
}

export type BlackjackShoeStatus = "active" | "finished";
export type BlackjackShoeEndReason = "cut_card" | "seed_rotated";

/**
 * A player's Blackjack shoe (#66): one nonce of a seed pair, dealt across hands until the cut
 * card. Its order is recomputed from the seeds; only its position is stored.
 */
export interface BlackjackShoesTable {
  id: Generated<string>;
  user_id: string;
  seed_pair_id: string;
  nonce: number;
  cut_card: number;
  /** Offset of the next hand's first card; advanced when a hand settles. */
  next_card: Generated<number>;
  status: ColumnType<BlackjackShoeStatus, BlackjackShoeStatus | undefined, BlackjackShoeStatus>;
  end_reason: BlackjackShoeEndReason | null;
  created_at: CreatedAt;
  finished_at: Date | null;
}

export interface Database {
  users: UsersTable;
  wallets: WalletsTable;
  seed_pairs: SeedPairsTable;
  game_rounds: GameRoundsTable;
  bets: BetsTable;
  blackjack_shoes: BlackjackShoesTable;
  transactions: TransactionsTable;
  ledger_entries: LedgerEntriesTable;
}

export type User = Selectable<UsersTable>;
export type NewUser = Insertable<UsersTable>;
export type Wallet = Selectable<WalletsTable>;
export type NewWallet = Insertable<WalletsTable>;
export type SeedPair = Selectable<SeedPairsTable>;
export type NewSeedPair = Insertable<SeedPairsTable>;
export type GameRound = Selectable<GameRoundsTable>;
export type NewGameRound = Insertable<GameRoundsTable>;
export type Bet = Selectable<BetsTable>;
export type NewBet = Insertable<BetsTable>;
export type BetUpdate = Updateable<BetsTable>;
export type LedgerTransaction = Selectable<TransactionsTable>;
export type NewLedgerTransaction = Insertable<TransactionsTable>;
export type LedgerEntry = Selectable<LedgerEntriesTable>;
export type NewLedgerEntry = Insertable<LedgerEntriesTable>;
