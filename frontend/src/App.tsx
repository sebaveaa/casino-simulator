import { useState } from "react";
import { type createBrowserRouter, RouterProvider } from "react-router";

import { type ApiClient, ApiProvider } from "./api";
import { BalanceProvider } from "./app/useBalance";
import { createSessionStore, SessionProvider, type SessionStore } from "./session";

/**
 * Root component: API client, session and the shared balance for the screens, plus the router.
 * `session` defaults to a store persisted in `localStorage`; `main.tsx` passes the one its API
 * client already uses so a rejected token clears the same session the screens read.
 */
export function App({
  client,
  router,
  session,
}: {
  client: ApiClient;
  router: ReturnType<typeof createBrowserRouter>;
  session?: SessionStore;
}) {
  const [store] = useState(() => session ?? createSessionStore());
  return (
    <ApiProvider client={client}>
      <SessionProvider store={store}>
        <BalanceProvider>
          <RouterProvider router={router} />
        </BalanceProvider>
      </SessionProvider>
    </ApiProvider>
  );
}
