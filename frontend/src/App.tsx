import { type createBrowserRouter, RouterProvider } from "react-router";

import { type ApiClient, ApiProvider } from "./api";
import { BalanceProvider } from "./app/useBalance";

/** Root component: API client and the shared balance for the screens, plus the router. */
export function App({
  client,
  router,
}: {
  client: ApiClient;
  router: ReturnType<typeof createBrowserRouter>;
}) {
  return (
    <ApiProvider client={client}>
      <BalanceProvider>
        <RouterProvider router={router} />
      </BalanceProvider>
    </ApiProvider>
  );
}
