import { MAX_MONEY } from "@casino/shared";
import { z } from "zod";

/** A positive whole number of stake units (minor units), kept as a bigint. */
const stakeSchema = z.coerce
  .bigint()
  .min(1n, "must be at least 1")
  .max(MAX_MONEY, "must fit in a bigint column");

const seconds = z.coerce.number().int().min(1);

const configSchema = z
  .object({
    DATABASE_URL: z.url(),
    REDIS_URL: z.url(),
    JWT_SECRET: z.string().min(32, "must be at least 32 characters"),
    APP_ENV: z.enum(["development", "production"]),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    ALLOWED_ORIGINS: z
      .string()
      .transform((value) =>
        value
          .split(",")
          .map((origin) => origin.trim())
          .filter((origin) => origin.length > 0),
      )
      .pipe(z.array(z.string()).min(1, "must list at least one origin")),
    PROCESS_ROLE: z.enum(["api", "worker"]).default("api"),
    RACE_BETTING_WINDOW_SECONDS: seconds.default(30),
    RACE_DURATION_SECONDS: seconds.default(10),
    RACE_MIN_STAKE: stakeSchema.default(1n),
    RACE_MAX_STAKE: stakeSchema.default(1000n),
  })
  .refine((env) => env.RACE_MIN_STAKE <= env.RACE_MAX_STAKE, {
    path: ["RACE_MIN_STAKE"],
    message: "must not be greater than RACE_MAX_STAKE",
  });

export type Config = {
  databaseUrl: string;
  redisUrl: string;
  jwtSecret: string;
  appEnv: "development" | "production";
  port: number;
  allowedOrigins: string[];
  processRole: "api" | "worker";
  /** How long a race round accepts bets. */
  raceWindowMs: number;
  /** How long the race animation lasts. */
  raceDurationMs: number;
  raceMinStake: bigint;
  raceMaxStake: bigint;
};

/**
 * Parses and validates the environment (README §13). On failure it throws one
 * error naming every invalid variable and the reason. It never echoes a value,
 * so secrets cannot leak into logs.
 */
export function loadConfig(source: NodeJS.ProcessEnv): Config {
  const result = configSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => {
      const name = issue.path.length > 0 ? issue.path.join(".") : "(environment)";
      const reason =
        issue.code === "invalid_type" && source[name] === undefined ? "is required" : issue.message;
      return `  - ${name}: ${reason}`;
    });
    throw new Error(`Invalid environment configuration:\n${problems.join("\n")}`);
  }
  const env = result.data;
  return {
    databaseUrl: env.DATABASE_URL,
    redisUrl: env.REDIS_URL,
    jwtSecret: env.JWT_SECRET,
    appEnv: env.APP_ENV,
    port: env.PORT,
    allowedOrigins: env.ALLOWED_ORIGINS,
    processRole: env.PROCESS_ROLE,
    raceWindowMs: env.RACE_BETTING_WINDOW_SECONDS * 1000,
    raceDurationMs: env.RACE_DURATION_SECONDS * 1000,
    raceMinStake: env.RACE_MIN_STAKE,
    raceMaxStake: env.RACE_MAX_STAKE,
  };
}
