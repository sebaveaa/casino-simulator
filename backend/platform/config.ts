import { z } from "zod";

const configSchema = z.object({
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
});

export type Config = {
  databaseUrl: string;
  redisUrl: string;
  jwtSecret: string;
  appEnv: "development" | "production";
  port: number;
  allowedOrigins: string[];
  processRole: "api" | "worker";
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
  };
}
