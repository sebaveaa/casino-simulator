import type { CrashEvent, CrashGame } from "@casino/shared";

/**
 * Fan-out of crash events from the worker to the API's realtime streams, the Crash counterpart of
 * {@link import("./race-events").RaceEventBus}. Unlike races, two games run at once (`dino-crash`
 * and `aviator`), so every call names the game and a subscriber only hears its own game's events.
 * PostgreSQL stays the source of truth, so a lost event only delays what clients see.
 */
export type CrashEventBus = {
  publish(game: CrashGame, event: CrashEvent): Promise<void>;
  /** Returns the unsubscribe function. */
  subscribe(game: CrashGame, listener: (event: CrashEvent) => void): () => void;
};

/** In-process bus: delivers each event to every listener of that game subscribed at the time. */
export function createMemoryCrashEventBus(): CrashEventBus {
  const listeners = new Map<CrashGame, Set<(event: CrashEvent) => void>>();
  return {
    async publish(game, event) {
      for (const listener of [...(listeners.get(game) ?? [])]) listener(event);
    },
    subscribe(game, listener) {
      // A wrapper, so subscribing the same function twice yields two independent subscriptions.
      const entry = (event: CrashEvent) => listener(event);
      const set = listeners.get(game) ?? new Set();
      set.add(entry);
      listeners.set(game, set);
      return () => {
        set.delete(entry);
        if (set.size === 0) listeners.delete(game);
      };
    },
  };
}
