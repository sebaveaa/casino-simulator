import { createContext, type ReactNode, useContext } from "react";
import type { ApiClient } from "./client";

const ApiContext = createContext<ApiClient | null>(null);

/** Makes `client` available to every screen below it through `useApi`. */
export function ApiProvider({ client, children }: { client: ApiClient; children: ReactNode }) {
  return <ApiContext.Provider value={client}>{children}</ApiContext.Provider>;
}

/** Returns the current `ApiClient`. Throws outside an `ApiProvider`. */
export function useApi(): ApiClient {
  const client = useContext(ApiContext);
  if (!client) throw new Error("useApi must be used inside an <ApiProvider>");
  return client;
}
