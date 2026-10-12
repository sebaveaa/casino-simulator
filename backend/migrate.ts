import pg from "pg";
import { createDatabase } from "./db/database";
import { parseMigrateEnv } from "./db/migrate-env";
import { migrateToLatest } from "./db/migrator";
import { postgresTypes } from "./platform/postgres";

async function main(): Promise<void> {
  let databaseUrl: string;
  try {
    ({ databaseUrl } = parseMigrateEnv(process.env));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  // Own pool: migrations may outlast the 1 s connection timeout meant for health pings.
  const pool = new pg.Pool({ connectionString: databaseUrl, types: postgresTypes });
  const db = createDatabase(pool);
  try {
    const results = await migrateToLatest(db);
    if (results.length === 0) console.log("No pending migrations");
    for (const result of results) console.log(`${result.migrationName}: ${result.status}`);
  } catch (error) {
    console.error("migration failed", error);
    process.exitCode = 1;
  } finally {
    await db.destroy();
  }
}

await main();
