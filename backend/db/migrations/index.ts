import type { Migration } from "kysely/migration";
import * as initial from "./0001_initial";
import * as ledgerHistoryIndex from "./0002_ledger_history_index";
import * as miniGames from "./0004_mini_games";
import * as raceRounds from "./0005_race_rounds";
import * as raceCurrentIndex from "./0006_race_current_index";
import * as racePartialIndexes from "./0007_race_round_partial_indexes";
import * as blackjack from "./0008_blackjack";
import * as blackjackShoes from "./0009_blackjack_shoes";

/**
 * Static registry, so esbuild bundles the migrations (no filesystem provider at runtime).
 * Kysely runs them in name order; add new ones with the next zero-padded number.
 * 0003 is intentionally unused.
 */
export const migrations: Record<string, Migration> = {
  "0001_initial": initial,
  "0002_ledger_history_index": ledgerHistoryIndex,
  "0004_mini_games": miniGames,
  "0005_race_rounds": raceRounds,
  "0006_race_current_index": raceCurrentIndex,
  "0007_race_round_partial_indexes": racePartialIndexes,
  "0008_blackjack": blackjack,
  "0009_blackjack_shoes": blackjackShoes,
};
