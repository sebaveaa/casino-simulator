import type { Kysely } from "kysely";
import { type MigrationResult, Migrator } from "kysely/migration";
import { migrations } from "./migrations";

// biome-ignore lint/suspicious/noExplicitAny: the migrator is independent of the live schema types
export function createMigrator(db: Kysely<any>): Migrator {
  return new Migrator({ db, provider: { getMigrations: async () => migrations } });
}

/** Applies every pending migration. Throws if one fails; returns what ran otherwise. */
// biome-ignore lint/suspicious/noExplicitAny: the migrator is independent of the live schema types
export async function migrateToLatest(db: Kysely<any>): Promise<MigrationResult[]> {
  const { error, results } = await createMigrator(db).migrateToLatest();
  if (error) throw error;
  return results ?? [];
}
