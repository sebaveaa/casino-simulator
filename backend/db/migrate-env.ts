import { z } from "zod";

const envSchema = z.object({ DATABASE_URL: z.url() });

/** Reads `DATABASE_URL`. The error names the problem and never echoes the value. */
export function parseMigrateEnv(source: NodeJS.ProcessEnv): { databaseUrl: string } {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const reason = source.DATABASE_URL === undefined ? "is required" : "must be a valid URL";
    throw new Error(`Invalid environment configuration:\n  - DATABASE_URL: ${reason}`);
  }
  return { databaseUrl: result.data.DATABASE_URL };
}
