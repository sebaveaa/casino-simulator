import { type CrashEvent, crashEventSchema, crashGameSchema } from "@casino/shared";
import type { Redis } from "ioredis";
import { z } from "zod";
import { reportRedisErrors } from "../platform/redis";
import type { CrashEventBus } from "./crash-events";

/**
 * One channel for every crash event of every game; the envelope names the game, and each subscriber
 * is given only the events of the game it asked for. A single channel keeps one subscriber
 * connection for both games, like the race bus.
 */
export const CRASH_CHANNEL = "crash";

const envelopeSchema = z.object({ game: crashGameSchema, event: crashEventSchema });

export type RedisCrashEventBus = CrashEventBus & {
  /** Disconnects the subscriber connection, if any. Safe to call more than once. */
  close(): Promise<void>;
};

export type RedisCrashEventBusOptions = {
  /** Called with connection errors and with received messages that were discarded. */
  onError?: (error: Error) => void;
};

/**
 * Crash events over Redis pub/sub, the Crash counterpart of `createRedisRaceEventBus`. `publisher`
 * is the shared client and only publishes. A subscribed connection cannot run other commands, so
 * the first listener creates one dedicated connection with `publisher.duplicate()`; it is closed
 * when the last listener leaves. Messages that are not valid envelopes are discarded, never thrown.
 */
export function createRedisCrashEventBus(
  publisher: Redis,
  options: RedisCrashEventBusOptions = {},
): RedisCrashEventBus {
  const onError = options.onError ?? ((error) => console.error("crash event bus:", error));
  const listeners = new Map<string, Set<(event: CrashEvent) => void>>();
  let subscriber: Redis | undefined;

  function dispatch(message: string): void {
    let json: unknown;
    try {
      json = JSON.parse(message);
    } catch (error) {
      onError(new Error("Discarded an invalid crash event message", { cause: error }));
      return;
    }
    const parsed = envelopeSchema.safeParse(json);
    if (!parsed.success) {
      onError(new Error("Discarded an invalid crash event message"));
      return;
    }
    const { game, event } = parsed.data;
    for (const listener of [...(listeners.get(game) ?? [])]) {
      try {
        listener(event);
      } catch (error) {
        onError(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  function open(): Redis {
    // The duplicate queues commands until connected, so a SUBSCRIBE sent right away is not lost.
    const connection = publisher.duplicate({ enableOfflineQueue: true });
    reportRedisErrors(connection, onError);
    connection.on("message", (channel: string, message: string) => {
      if (channel === CRASH_CHANNEL) dispatch(message);
    });
    // Also on every reconnect: a SUBSCRIBE is per connection and the queue may have been flushed.
    connection.on("ready", () => {
      connection.subscribe(CRASH_CHANNEL).catch(onError);
    });
    connection.subscribe(CRASH_CHANNEL).catch(onError);
    return connection;
  }

  function teardown(): void {
    const connection = subscriber;
    if (!connection) return;
    subscriber = undefined;
    connection.unsubscribe(CRASH_CHANNEL).catch(() => undefined);
    connection.disconnect();
  }

  return {
    async publish(game, event) {
      await publisher.publish(CRASH_CHANNEL, JSON.stringify({ game, event }));
    },
    subscribe(game, listener) {
      // A wrapper, so subscribing the same function twice yields two independent subscriptions.
      const entry = (event: CrashEvent) => listener(event);
      const set = listeners.get(game) ?? new Set();
      set.add(entry);
      listeners.set(game, set);
      subscriber ??= open();
      return () => {
        if (!set.delete(entry)) return;
        if (set.size === 0) listeners.delete(game);
        if ([...listeners.values()].every((s) => s.size === 0)) teardown();
      };
    },
    async close() {
      listeners.clear();
      teardown();
    },
  };
}
