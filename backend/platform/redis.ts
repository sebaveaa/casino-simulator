import { Redis } from "ioredis";
import type { Config } from "./config";
import { withTimeout } from "./timeout";

const PING_TIMEOUT_MS = 1000;

/**
 * Reports Redis errors to `onError`. ioredis re-emits the same error on every reconnect
 * attempt, so repeats of the last message are skipped until the connection is ready again.
 */
export function reportRedisErrors(
  client: Pick<Redis, "on">,
  onError: (error: Error) => void,
): void {
  let lastMessage: string | undefined;
  client.on("error", (error: Error) => {
    if (error.message === lastMessage) return;
    lastMessage = error.message;
    onError(error);
  });
  client.on("ready", () => {
    lastMessage = undefined;
  });
}

export function createRedisClient(
  config: Pick<Config, "redisUrl">,
  onError: (error: Error) => void,
): Redis {
  const client = new Redis(config.redisUrl, {
    // Fail commands immediately while disconnected instead of queueing them forever.
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: PING_TIMEOUT_MS,
    commandTimeout: PING_TIMEOUT_MS,
  });
  // Without a listener an unreachable Redis would crash on unhandled error events.
  reportRedisErrors(client, onError);
  return client;
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
