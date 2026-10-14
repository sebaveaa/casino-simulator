import { type AuthUser, authUserSchema } from "@casino/shared";
import { z } from "zod";
import { readJwtExpiry } from "./jwt";

export const SESSION_STORAGE_KEY = "casino.session";

export interface Session {
  token: string;
  user: AuthUser;
}

export interface SessionStore {
  get(): Session | null;
  set(session: Session): void;
  clear(): void;
  subscribe(listener: () => void): () => void;
}

const storedSessionSchema = z.object({ token: z.string().min(1), user: authUserSchema });

export interface SessionStoreOptions {
  /** Returns the storage to persist into; may throw or return null when storage is blocked. */
  storage?: () => Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
  /** Current time in milliseconds. */
  now?: () => number;
}

/**
 * Holds the session in memory and mirrors it into storage. Every storage access is wrapped, so a
 * blocked or throwing storage degrades to an in-memory session. A stored token that is expired
 * or cannot be decoded is discarded on load.
 */
export function createSessionStore(options: SessionStoreOptions = {}): SessionStore {
  const getStorage = options.storage ?? (() => window.localStorage);
  const now = options.now ?? Date.now;
  const listeners = new Set<() => void>();

  function persist(action: (storage: NonNullable<ReturnType<typeof getStorage>>) => void): void {
    try {
      const storage = getStorage();
      if (storage) action(storage);
    } catch {
      // Storage is unavailable: the session still works until the page closes.
    }
  }

  function load(): Session | null {
    let raw: string | null = null;
    persist((storage) => {
      raw = storage.getItem(SESSION_STORAGE_KEY);
    });
    if (raw === null) return null;
    try {
      const parsed = storedSessionSchema.safeParse(JSON.parse(raw));
      const expiry = parsed.success ? readJwtExpiry(parsed.data.token) : null;
      if (parsed.success && expiry !== null && expiry * 1000 > now()) return parsed.data;
    } catch {
      // Corrupt JSON falls through to discarding the entry.
    }
    persist((storage) => storage.removeItem(SESSION_STORAGE_KEY));
    return null;
  }

  let current = load();

  function replace(next: Session | null): void {
    current = next;
    persist((storage) => {
      if (next) storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(next));
      else storage.removeItem(SESSION_STORAGE_KEY);
    });
    for (const listener of listeners) listener();
  }

  return {
    get: () => current,
    set: (session) => replace(session),
    clear: () => {
      if (current !== null) replace(null);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
