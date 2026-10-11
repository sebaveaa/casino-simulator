import { type createBrowserRouter, RouterProvider } from "react-router";

import { type ApiClient, ApiProvider } from "./api";

/** Root component: API client for the screens plus the router. */
export function App({
  client,
  router,
}: {
  client: ApiClient;
  router: ReturnType<typeof createBrowserRouter>;
}) {
  return (
    <ApiProvider client={client}>
      <RouterProvider router={router} />
    </ApiProvider>
  );
}
