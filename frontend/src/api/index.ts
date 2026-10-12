import type { ApiClient } from "./client";
import { createHttpApiClient } from "./http";
import { createMockApiClient } from "./mock";

export { type ApiClient, ApiError } from "./client";
export { ApiProvider, useApi } from "./context";
export { createMockApiClient } from "./mock";

/**
 * HTTP client when `VITE_API_URL` is set, in-memory mock otherwise.
 * The session token arrives with #9.
 */
export function createApiClient(): ApiClient {
  const baseUrl = import.meta.env.VITE_API_URL;
  if (baseUrl) return createHttpApiClient({ baseUrl, getToken: () => null });
  return createMockApiClient({ delayMs: 150 });
}
