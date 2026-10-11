import type { Migration } from "kysely/migration";
import * as initial from "./0001_initial";

/**
 * Static registry, so esbuild bundles the migrations (no filesystem provider at runtime).
 * Kysely runs them in name order; add new ones with the next zero-padded number.
 */
export const migrations: Record<string, Migration> = {
  "0001_initial": initial,
};
