import { type RaceEvent, raceEventSchema } from "@casino/shared";
import type { Redis } from "ioredis";
import { reportRedisErrors } from "../platform/redis";
import type { RaceEventBus } from "./race-events";

/** One channel for every race event: a single round is active at a time. */
export const RACE_CHANNEL = "races";

export type RedisRaceEventBus = RaceEventBus & {
  /** Disconnects the subscriber connection, if any. Safe to call more than once. */
  close(): Promise<void>;
};

export type RedisRaceEventBusOptions = {
  /** Called with connection errors and with received messages that were discarded. */
  onError?: (error: Error) => void;
};

/**
 * Race events over Redis pub/sub. `publisher` is the shared client and only publishes. A
 * subscribed connection cannot run other commands, so the first listener creates one dedicated
 * connection with `publisher.duplicate()`; it is closed when the last listener leaves.
 * Messages that are not valid {@link RaceEvent}s are discarded, never thrown.
 */
export function createRedisRaceEventBus(
  publisher: Redis,
  options: RedisRaceEventBusOptions = {},
): RedisRaceEventBus {
  const onError = options.onError ?? ((error) => console.error("race event bus:", error));
  const listeners = new Set<(event: RaceEvent) => void>();
  let subscriber: Redis | undefined;

  function dispatch(message: string): void {
    let event: RaceEvent;
    try {
      event = raceEventSchema.parse(JSON.parse(message));
    } catch (error) {
      onError(new Error("Discarded an invalid race event message", { cause: error }));
      return;
    }
    for (const listener of [...listeners]) {
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
      if (channel === RACE_CHANNEL) dispatch(message);
    });
    // Also on every reconnect: a SUBSCRIBE is per connection and the queue may have been flushed.
    connection.on("ready", () => {
      connection.subscribe(RACE_CHANNEL).catch(onError);
    });
    connection.subscribe(RACE_CHANNEL).catch(onError);
    return connection;
  }

  function teardown(): void {
    const connection = subscriber;
    if (!connection) return;
    subscriber = undefined;
    connection.unsubscribe(RACE_CHANNEL).catch(() => undefined);
    connection.disconnect();
  }

  return {
    async publish(event) {
      await publisher.publish(RACE_CHANNEL, JSON.stringify(event));
    },
    subscribe(listener) {
      // A wrapper, so subscribing the same function twice yields two independent subscriptions.
      const entry = (event: RaceEvent) => listener(event);
      listeners.add(entry);
      subscriber ??= open();
      return () => {
        if (!listeners.delete(entry)) return;
        if (listeners.size === 0) teardown();
      };
    },
    async close() {
      listeners.clear();
      teardown();
    },
  };
}
