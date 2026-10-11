import pg from "pg";
import type { Config } from "./config";
import { withTimeout } from "./timeout";

const PING_TIMEOUT_MS = 1000;

export function createPostgresPool(
  config: Pick<Config, "databaseUrl">,
  onError: (error: Error) => void,
): pg.Pool {
  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    connectionTimeoutMillis: PING_TIMEOUT_MS,
  });
  // An idle client that errors (server restart, dropped connection) emits on the pool;
  // without a listener Node treats it as unhandled and kills the process.
  pool.on("error", (error) => onError(error));
  return pool;
}

/**
 * Resolves true when PostgreSQL answers `SELECT 1` within the timeout, false otherwise.
 * The checkout wait is bounded by the pool's `connectionTimeoutMillis`; the query by `timeoutMs`.
 */
export async function pingPostgres(pool: pg.Pool, timeoutMs = PING_TIMEOUT_MS): Promise<boolean> {
  let client: pg.PoolClient;
  try {
    client = await pool.connect();
  } catch {
    return false;
  }
  try {
    await withTimeout(client.query("SELECT 1"), timeoutMs);
    client.release();
    return true;
  } catch (error) {
    // Releasing with an error destroys the client, so a hung query cannot hold a pool slot.
    client.release(error instanceof Error ? error : new Error(String(error)));
    return false;
  }
}
