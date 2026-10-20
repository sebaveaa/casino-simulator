import type { RaceEvent } from "@casino/shared";

/**
 * Fan-out of race events from the worker to the API's realtime streams (README §6). The worker
 * publishes after each transition commits; PostgreSQL stays the source of truth, so a lost
 * event only delays what clients see.
 */
export type RaceEventBus = {
  publish(event: RaceEvent): Promise<void>;
  /** Returns the unsubscribe function. */
  subscribe(listener: (event: RaceEvent) => void): () => void;
};

/** In-process bus: delivers each event to every listener subscribed at the time. */
export function createMemoryRaceEventBus(): RaceEventBus {
  const listeners = new Set<(event: RaceEvent) => void>();
  return {
    async publish(event) {
      for (const listener of [...listeners]) listener(event);
    },
    subscribe(listener) {
      // A wrapper, so subscribing the same function twice yields two independent subscriptions.
      const entry = (event: RaceEvent) => listener(event);
      listeners.add(entry);
      return () => {
        listeners.delete(entry);
      };
    },
  };
}
