import { Kysely, PostgresDialect } from "kysely";
import type pg from "pg";
import type { Database } from "./schema";

/**
 * The query executor services receive. A `Transaction<Database>` is assignable to it, so a
 * service runs in the caller's single `BEGIN … COMMIT` when given a transaction.
 */
export type Db = Kysely<Database>;

export function createDatabase(pool: pg.Pool): Db {
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}
