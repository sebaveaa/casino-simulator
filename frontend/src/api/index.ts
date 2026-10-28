import type { SessionStore } from "../session";
import type { ApiClient } from "./client";
import { createHttpApiClient } from "./http";
import { createMockApiClient } from "./mock";

export { type ApiClient, ApiError } from "./client";
export { ApiProvider, useApi } from "./context";
export { createMockApiClient } from "./mock";

/**
 * HTTP client when `VITE_API_URL` is set, in-memory mock otherwise. The HTTP client sends the
 * session's bearer token and clears the session when the server rejects it.
 */
export function createApiClient(session: SessionStore): ApiClient {
  const baseUrl = import.meta.env.VITE_API_URL;
  if (baseUrl) {
    return createHttpApiClient({
      baseUrl,
      getToken: () => session.get()?.token ?? null,
      onUnauthorized: () => session.clear(),
    });
  }
  const shoeDealt = Number(import.meta.env.VITE_MOCK_BLACKJACK_SHOE_DEALT ?? 0);
  return createMockApiClient({
    delayMs: 150,
    blackjackShoeDealt: Number.isInteger(shoeDealt) && shoeDealt > 0 ? shoeDealt : 0,
  });
}
