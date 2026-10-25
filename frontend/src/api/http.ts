import type { CrashEvent, CrashGame, RaceEvent } from "@casino/shared";
import {
  apiPaths,
  authResponseSchema,
  balanceResponseSchema,
  chickenRoadCashoutResponseSchema,
  chickenRoadCurrentResponseSchema,
  chickenRoadHistoryResponseSchema,
  chickenRoadStartResponseSchema,
  chickenRoadStepResponseSchema,
  crashBetResponseSchema,
  crashCashoutResponseSchema,
  crashCurrentResponseSchema,
  crashEventSchema,
  crashHistoryResponseSchema,
  currentRaceResponseSchema,
  depositResponseSchema,
  errorResponseSchema,
  IDEMPOTENCY_KEY_HEADER,
  raceBetResponseSchema,
  raceEventSchema,
  rouletteBetResponseSchema,
  seedPairResponseSchema,
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
  /** Waits before each stream reconnection attempt; the last value repeats. Default 1 s up to 10 s. */
  streamReconnectDelaysMs?: number[];
}

const DEFAULT_RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 10000];

/** The `data:` payload of one SSE block, or null for comments and blocks without data. */
function sseData(block: string): string | null {
  const lines: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith(":")) continue;
    if (line.startsWith("data:")) lines.push(line.slice(5).replace(/^ /, ""));
  }
  return lines.length > 0 ? lines.join("\n") : null;
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

  const reconnectDelays =
    options.streamReconnectDelaysMs && options.streamReconnectDelaysMs.length > 0
      ? options.streamReconnectDelaysMs
      : DEFAULT_RECONNECT_DELAYS_MS;

  function watchRaces(
    onEvent: (event: RaceEvent) => void,
    onStatus?: (status: "connected" | "reconnecting") => void,
  ): () => void {
    let closed = false;
    let controller: AbortController | null = null;
    let wake: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function wait(ms: number): Promise<void> {
      return new Promise((resolve) => {
        wake = resolve;
        timer = setTimeout(resolve, ms);
      });
    }

    function dispatch(block: string): void {
      const data = sseData(block);
      if (data === null) return;
      let json: unknown;
      try {
        json = JSON.parse(data);
      } catch {
        return;
      }
      const parsed = raceEventSchema.safeParse(json);
      if (!parsed.success) return;
      try {
        onEvent(parsed.data);
      } catch {
        // A listener bug must not be treated as a stream failure.
      }
    }

    async function run(): Promise<void> {
      let attempt = 0;
      while (!closed) {
        controller = new AbortController();
        try {
          const token = options.getToken();
          const headers: Record<string, string> = { accept: "text/event-stream" };
          if (token) headers.authorization = `Bearer ${token}`;
          const response = await doFetch(`${baseUrl}${apiPaths.raceStream}`, {
            method: "GET",
            headers,
            signal: controller.signal,
          });
          if (closed) return;
          if (response.status === 401 || response.status === 403) {
            void response.body?.cancel();
            if (token) options.onUnauthorized?.();
            return;
          }
          if (!response.ok) void response.body?.cancel();
          if (response.ok && response.body) {
            onStatus?.("connected");
            attempt = 0;
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const blocks = buffer.split(/\r?\n\r?\n/);
              buffer = blocks.pop() ?? "";
              for (const block of blocks) dispatch(block);
            }
          }
        } catch {
          // Network failure or abort: handled below.
        }
        if (closed) return;
        onStatus?.("reconnecting");
        const delay = reconnectDelays[Math.min(attempt, reconnectDelays.length - 1)] ?? 1000;
        attempt += 1;
        await wait(delay);
      }
    }

    void run();

    return () => {
      if (closed) return;
      closed = true;
      controller?.abort();
      clearTimeout(timer);
      wake?.();
    };
  }

  // A Crash stream, parameterised by game. Same transport and reconnection as `watchRaces`.
  function watchCrash(
    game: CrashGame,
    onEvent: (event: CrashEvent) => void,
    onStatus?: (status: "connected" | "reconnecting") => void,
  ): () => void {
    const path = apiPaths.crashStream.replace(":game", game);
    let closed = false;
    let controller: AbortController | null = null;
    let wake: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function wait(ms: number): Promise<void> {
      return new Promise((resolve) => {
        wake = resolve;
        timer = setTimeout(resolve, ms);
      });
    }

    function dispatch(block: string): void {
      const data = sseData(block);
      if (data === null) return;
      let json: unknown;
      try {
        json = JSON.parse(data);
      } catch {
        return;
      }
      const parsed = crashEventSchema.safeParse(json);
      if (!parsed.success) return;
      try {
        onEvent(parsed.data);
      } catch {
        // A listener bug must not be treated as a stream failure.
      }
    }

    async function run(): Promise<void> {
      let attempt = 0;
      while (!closed) {
        controller = new AbortController();
        try {
          const token = options.getToken();
          const headers: Record<string, string> = { accept: "text/event-stream" };
          if (token) headers.authorization = `Bearer ${token}`;
          const response = await doFetch(`${baseUrl}${path}`, {
            method: "GET",
            headers,
            signal: controller.signal,
          });
          if (closed) return;
          if (response.status === 401 || response.status === 403) {
            void response.body?.cancel();
            if (token) options.onUnauthorized?.();
            return;
          }
          if (!response.ok) void response.body?.cancel();
          if (response.ok && response.body) {
            onStatus?.("connected");
            attempt = 0;
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const blocks = buffer.split(/\r?\n\r?\n/);
              buffer = blocks.pop() ?? "";
              for (const block of blocks) dispatch(block);
            }
          }
        } catch {
          // Network failure or abort: handled below.
        }
        if (closed) return;
        onStatus?.("reconnecting");
        const delay = reconnectDelays[Math.min(attempt, reconnectDelays.length - 1)] ?? 1000;
        attempt += 1;
        await wait(delay);
      }
    }

    void run();

    return () => {
      if (closed) return;
      closed = true;
      controller?.abort();
      clearTimeout(timer);
      wake?.();
    };
  }

  const crashPath = (template: string, game: CrashGame, betId?: string) => {
    const withGame = template.replace(":game", game);
    return betId ? withGame.replace(":betId", betId) : withGame;
  };

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
    getCurrentRace: () =>
      request(currentRaceResponseSchema, { method: "GET", path: apiPaths.raceCurrent }),
    placeRaceBet: (body, idempotencyKey) =>
      request(raceBetResponseSchema, {
        method: "POST",
        path: apiPaths.raceBets,
        body,
        idempotencyKey,
      }),
    watchRaces,
    getSeedPair: () => request(seedPairResponseSchema, { method: "GET", path: apiPaths.seedPair }),
    startChickenRoadGame: (body, idempotencyKey) =>
      request(chickenRoadStartResponseSchema, {
        method: "POST",
        path: apiPaths.chickenRoadGames,
        body,
        idempotencyKey,
      }),
    stepChickenRoadGame: (body) =>
      request(chickenRoadStepResponseSchema, {
        method: "POST",
        path: apiPaths.chickenRoadSteps,
        body,
      }),
    cashOutChickenRoadGame: (body) =>
      request(chickenRoadCashoutResponseSchema, {
        method: "POST",
        path: apiPaths.chickenRoadCashout,
        body,
      }),
    getCurrentChickenRoadGame: () =>
      request(chickenRoadCurrentResponseSchema, {
        method: "GET",
        path: apiPaths.chickenRoadCurrent,
      }),
    listChickenRoadHistory: (query = {}) =>
      request(chickenRoadHistoryResponseSchema, {
        method: "GET",
        path:
          query.limit === undefined
            ? apiPaths.chickenRoadGames
            : `${apiPaths.chickenRoadGames}?limit=${query.limit}`,
      }),
    getCurrentCrash: (game) =>
      request(crashCurrentResponseSchema, {
        method: "GET",
        path: crashPath(apiPaths.crashCurrent, game),
      }),
    placeCrashBet: (game, body, idempotencyKey) =>
      request(crashBetResponseSchema, {
        method: "POST",
        path: crashPath(apiPaths.crashBets, game),
        body,
        idempotencyKey,
      }),
    cashOutCrash: (game, betId) =>
      request(crashCashoutResponseSchema, {
        method: "POST",
        path: crashPath(apiPaths.crashCashout, game, betId),
      }),
    watchCrash,
    listCrashHistory: (game, query = {}) =>
      request(crashHistoryResponseSchema, {
        method: "GET",
        path:
          query.limit === undefined
            ? crashPath(apiPaths.crashRounds, game)
            : `${crashPath(apiPaths.crashRounds, game)}?limit=${query.limit}`,
      }),
  };
}
