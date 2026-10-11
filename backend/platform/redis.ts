import { Redis } from "ioredis";
import type { Config } from "./config";
import { withTimeout } from "./timeout";

const PING_TIMEOUT_MS = 1000;

export function createRedisClient(config: Pick<Config, "redisUrl">): Redis {
  return new Redis(config.redisUrl, {
    // Fail commands immediately while disconnected instead of queueing them forever.
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: PING_TIMEOUT_MS,
    commandTimeout: PING_TIMEOUT_MS,
  });
}

/** Resolves true when Redis answers PING within the timeout, false otherwise. */
export async function pingRedis(client: Redis, timeoutMs = PING_TIMEOUT_MS): Promise<boolean> {
  try {
    await withTimeout(client.ping(), timeoutMs);
    return true;
  } catch {
    return false;
  }
}
