import {
  apiPaths,
  authResponseSchema,
  balanceResponseSchema,
  depositResponseSchema,
  errorResponseSchema,
  IDEMPOTENCY_KEY_HEADER,
  rouletteBetResponseSchema,
  transactionHistoryResponseSchema,
} from "@casino/shared";
import type { z } from "zod";
import { type ApiClient, ApiError } from "./client";

export interface HttpApiClientOptions {
  baseUrl: string;
  /** Returns the session token, or null when logged out. */
  getToken: () => string | null;
  /** Called when the server rejects the session token (401 on a guarded call). */
  onUnauthorized?: () => void;
  fetch?: typeof fetch;
}

/** `ApiClient` that talks to the backend over HTTP, validating every response with the shared schemas. */
export function createHttpApiClient(options: HttpApiClientOptions): ApiClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const doFetch = options.fetch ?? ((...args) => fetch(...args));

  async function request<S extends z.ZodType>(
    schema: S,
    init: {
      method: string;
      path: string;
      body?: unknown;
      idempotencyKey?: string;
      /** Login and register: no bearer token, and a 401 means bad credentials, not a dead session. */
      public?: boolean;
    },
  ): Promise<z.output<S>> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (init.body !== undefined) headers["content-type"] = "application/json";
    const token = init.public ? null : options.getToken();
    if (token) headers.authorization = `Bearer ${token}`;
    if (init.idempotencyKey) headers[IDEMPOTENCY_KEY_HEADER] = init.idempotencyKey;

    let response: Response;
    try {
      response = await doFetch(`${baseUrl}${init.path}`, {
        method: init.method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
    } catch {
      throw new ApiError("network", "Could not reach the server", 0);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = undefined;
    }

    if (!response.ok) {
      if (response.status === 401 && token) options.onUnauthorized?.();
      const parsed = errorResponseSchema.safeParse(payload);
      if (parsed.success) {
        throw new ApiError(parsed.data.error.code, parsed.data.error.message, response.status);
      }
      throw new ApiError("internal", "Unexpected error response", response.status);
    }

    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new ApiError(
        "invalid_response",
        "The server sent an unexpected response",
        response.status,
      );
    }
    return parsed.data;
  }

  return {
    register: (body) =>
      request(authResponseSchema, { method: "POST", path: apiPaths.register, body, public: true }),
    login: (body) =>
      request(authResponseSchema, { method: "POST", path: apiPaths.login, body, public: true }),
    getBalance: () => request(balanceResponseSchema, { method: "GET", path: apiPaths.balance }),
    deposit: (body, idempotencyKey) =>
      request(depositResponseSchema, {
        method: "POST",
        path: apiPaths.deposits,
        body,
        idempotencyKey,
      }),
    listTransactions: (query = {}) => {
      const params = new URLSearchParams();
      if (query.limit !== undefined) params.set("limit", String(query.limit));
      if (query.cursor !== undefined) params.set("cursor", query.cursor);
      const qs = params.toString();
      return request(transactionHistoryResponseSchema, {
        method: "GET",
        path: qs ? `${apiPaths.transactions}?${qs}` : apiPaths.transactions,
      });
    },
    placeRouletteBet: (body, idempotencyKey) =>
      request(rouletteBetResponseSchema, {
        method: "POST",
        path: apiPaths.rouletteBets,
        body,
        idempotencyKey,
      }),
  };
}
