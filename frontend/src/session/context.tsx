import { createContext, type ReactNode, useContext, useSyncExternalStore } from "react";
import type { Session, SessionStore } from "./store";

const SessionContext = createContext<SessionStore | null>(null);

/** Makes `store` available to every screen below it through `useSession`. */
export function SessionProvider({ store, children }: { store: SessionStore; children: ReactNode }) {
  return <SessionContext.Provider value={store}>{children}</SessionContext.Provider>;
}

/** Returns the session store, for screens that sign in or out. Throws outside a `SessionProvider`. */
export function useSessionStore(): SessionStore {
  const store = useContext(SessionContext);
  if (!store) throw new Error("useSession must be used inside a <SessionProvider>");
  return store;
}

/** Returns the current session, or null when logged out, and re-renders when it changes. */
export function useSession(): Session | null {
  const store = useSessionStore();
  return useSyncExternalStore(store.subscribe, store.get);
}
