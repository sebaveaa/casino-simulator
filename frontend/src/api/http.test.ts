import type { RaceEvent } from "@casino/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./client";
import { createHttpApiClient } from "./http";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

function setup(response: Response | Error, token: string | null = "tok") {
  const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>) => {
    if (response instanceof Error) throw response;
    return response;
  });
  const client = createHttpApiClient({
    baseUrl: "http://api.test/",
    getToken: () => token,
    fetch: fetchMock as unknown as typeof fetch,
  });
  return { client, fetchMock };
}

describe("HTTP API client", () => {
  it("sends method, path, body, auth and idempotency headers", async () => {
    const { client, fetchMock } = setup(
      json({ transactionId: crypto.randomUUID(), balance: "1500" }),
    );
    const res = await client.deposit({ amount: "500" }, "key-00000001");
    expect(res.balance).toBe("1500");
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("http://api.test/wallet/deposits");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ amount: "500" }));
    const headers = init?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer tok");
    expect(headers["idempotency-key"]).toBe("key-00000001");
    expect(headers["content-type"]).toBe("application/json");
  });

  it("omits Authorization without a token and builds the history query", async () => {
    const { client, fetchMock } = setup(json({ items: [], nextCursor: null }), null);
    await client.listTransactions({ limit: 5, cursor: "abc" });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("http://api.test/wallet/transactions?limit=5&cursor=abc");
    expect(init?.method).toBe("GET");
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
  });

  it("maps an error body to ApiError", async () => {
    const { client } = setup(
      json({ error: { code: "insufficient_funds", message: "Not enough credits" } }, 409),
    );
    const error = await client.getBalance().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: "insufficient_funds", status: 409 });
    expect((error as ApiError).message).toBe("Not enough credits");
  });

  it("falls back to internal for a non-error failure body", async () => {
    const { client } = setup(new Response("oops", { status: 502 }));
    await expect(client.getBalance()).rejects.toMatchObject({ code: "internal", status: 502 });
  });

  it("rejects a success body that violates the schema", async () => {
    const { client } = setup(json({ balance: -5 }));
    await expect(client.getBalance()).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("calls onUnauthorized when a guarded call is answered with 401", async () => {
    const onUnauthorized = vi.fn();
    const client = createHttpApiClient({
      baseUrl: "http://api.test",
      getToken: () => "tok",
      onUnauthorized,
      fetch: (async () =>
        json({ error: { code: "unauthorized", message: "expired" } }, 401)) as typeof fetch,
    });
    await expect(client.getBalance()).rejects.toMatchObject({ code: "unauthorized", status: 401 });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("sends login without the token and does not treat its 401 as a dead session", async () => {
    const onUnauthorized = vi.fn();
    const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>) =>
      json({ error: { code: "unauthorized", message: "Invalid email or password" } }, 401),
    );
    const client = createHttpApiClient({
      baseUrl: "http://api.test",
      getToken: () => "stale",
      onUnauthorized,
      fetch: fetchMock as unknown as typeof fetch,
    });
    await expect(client.login({ email: "a@b.co", password: "x" })).rejects.toMatchObject({
      code: "unauthorized",
    });
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("logs in and registers against the auth paths", async () => {
    const session = {
      token: "t",
      user: { id: crypto.randomUUID(), email: "a@b.co", role: "player" },
    };
    const { client, fetchMock } = setup(json(session, 201));
    await expect(client.register({ email: "a@b.co", password: "password123" })).resolves.toEqual(
      session,
    );
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://api.test/auth/register");
  });

  it("maps a rejected fetch to a network error", async () => {
    const { client } = setup(new TypeError("failed to fetch"));
    await expect(client.getBalance()).rejects.toMatchObject({ code: "network", status: 0 });
  });
});

const HASH = "a".repeat(64);
const ROUND_ID = "11111111-1111-4111-8111-111111111111";
const openRound = {
  id: ROUND_ID,
  status: "open",
  opensAt: "2026-01-01T00:00:00.000Z",
  closesAt: "2026-01-01T00:00:30.000Z",
  serverSeedHash: HASH,
};

describe("HTTP API client races calls", () => {
  it("reads the current race and validates it", async () => {
    const body = {
      round: openRound,
      myBet: null,
      now: "2026-01-01T00:00:05.000Z",
      limits: { minStake: "100", maxStake: "100000" },
      raceDurationMs: 10000,
    };
    const { client, fetchMock } = setup(json(body));
    await expect(client.getCurrentRace()).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://api.test/races/current");
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("GET");
  });

  it("rejects a current race that leaks secrets while open", async () => {
    const { client } = setup(
      json({
        round: { ...openRound, serverSeed: "seed" },
        myBet: null,
        now: "2026-01-01T00:00:05.000Z",
        limits: { minStake: "100", maxStake: "100000" },
        raceDurationMs: 10000,
      }),
    );
    await expect(client.getCurrentRace()).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("rejects a current race without the stake limits or the race duration", async () => {
    const { client } = setup(json({ round: null, myBet: null, now: "2026-01-01T00:00:05.000Z" }));
    await expect(client.getCurrentRace()).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("places a race bet with the idempotency key", async () => {
    const response = {
      betId: crypto.randomUUID(),
      roundId: ROUND_ID,
      animal: 2,
      stake: "100",
      balance: "900",
    };
    const { client, fetchMock } = setup(json(response, 201));
    await expect(
      client.placeRaceBet({ roundId: ROUND_ID, animal: 2, stake: "100" }, "key-00000009"),
    ).resolves.toEqual(response);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("http://api.test/games/races/bets");
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers["idempotency-key"]).toBe("key-00000009");
    expect(headers.authorization).toBe("Bearer tok");
  });

  it("maps a 409 on a race bet to a conflict and rejects a bad bet response", async () => {
    const conflict = setup(
      json({ error: { code: "conflict", message: "Already bet in this round" } }, 409),
    );
    await expect(
      conflict.client.placeRaceBet({ roundId: ROUND_ID, animal: 0, stake: "1" }, "key-00000001"),
    ).rejects.toMatchObject({ code: "conflict", status: 409 });
    const bad = setup(json({ betId: "nope" }, 201));
    await expect(
      bad.client.placeRaceBet({ roundId: ROUND_ID, animal: 0, stake: "1" }, "key-00000002"),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });
});

describe("HTTP API client race stream", () => {
  const encoder = new TextEncoder();
  const opened = { type: "opened", round: openRound };
  const closedEvent = { type: "closed", roundId: ROUND_ID };
  const settled = { type: "settled", roundId: ROUND_ID };
  const sse = (event: unknown) => `data: ${JSON.stringify(event)}\n\n`;

  /** A response whose body the test feeds chunk by chunk. */
  function streamResponse(status = 200) {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
    });
    const response = new Response(body, {
      status,
      headers: { "content-type": "text/event-stream" },
    });
    return {
      response,
      push: (text: string) => controller.enqueue(encoder.encode(text)),
      end: () => controller.close(),
    };
  }

  const tick = () => vi.advanceTimersByTimeAsync(0);

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function watch(
    responses: Array<Response | Error>,
    extra: {
      onUnauthorized?: () => void;
      delays?: number[];
      token?: string | null;
      onEvent?: (e: RaceEvent) => void;
    } = {},
  ) {
    const queue = [...responses];
    const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>) => {
      const next = queue.shift();
      if (!next) return new Promise<Response>(() => {});
      if (next instanceof Error) throw next;
      return next;
    });
    const client = createHttpApiClient({
      baseUrl: "http://api.test",
      getToken: () => (extra.token === undefined ? "tok" : extra.token),
      onUnauthorized: extra.onUnauthorized,
      fetch: fetchMock as unknown as typeof fetch,
      streamReconnectDelaysMs: extra.delays ?? [1000, 2000, 4000, 10000],
    });
    const events: RaceEvent[] = [];
    const statuses: string[] = [];
    const close = client.watchRaces(
      (e) => {
        events.push(e);
        extra.onEvent?.(e);
      },
      (s) => statuses.push(s),
    );
    return { fetchMock, events, statuses, close };
  }

  it("sends the bearer and accept headers to the stream path", async () => {
    const s = streamResponse();
    const { fetchMock, statuses, close } = watch([s.response]);
    await tick();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("http://api.test/races/stream");
    const headers = init?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer tok");
    expect(headers.accept).toBe("text/event-stream");
    expect(statuses).toEqual(["connected"]);
    close();
  });

  it("parses events split across chunks and several per chunk", async () => {
    const s = streamResponse();
    const { events, close } = watch([s.response]);
    await tick();
    const first = sse(opened);
    s.push(first.slice(0, 10));
    await tick();
    expect(events).toHaveLength(0);
    s.push(first.slice(10) + sse(closedEvent) + sse(settled).slice(0, 5));
    await tick();
    expect(events).toEqual([opened, closedEvent]);
    s.push(sse(settled).slice(5));
    await tick();
    expect(events).toEqual([opened, closedEvent, settled]);
    close();
  });

  it("ignores comments and invalid payloads", async () => {
    const s = streamResponse();
    const { events, close } = watch([s.response]);
    await tick();
    s.push(": connected\n\n: ping\n\n");
    s.push("data: not json\n\n");
    s.push(sse({ type: "unknown" }));
    s.push(sse(closedEvent));
    await tick();
    expect(events).toEqual([closedEvent]);
    close();
  });

  it("reports reconnecting when the stream ends and reconnects with the delays", async () => {
    const a = streamResponse();
    const b = streamResponse();
    const { fetchMock, events, statuses, close } = watch([a.response, b.response]);
    await tick();
    a.end();
    await tick();
    expect(statuses).toEqual(["connected", "reconnecting"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(statuses).toEqual(["connected", "reconnecting", "connected"]);
    b.push(sse(settled));
    await tick();
    expect(events).toEqual([settled]);
    close();
  });

  it("backs off exponentially on failures, and resets after a good connection", async () => {
    const good = streamResponse();
    const { fetchMock, close } = watch(
      [new TypeError("down"), new TypeError("down"), good.response, new TypeError("down")],
      { delays: [1000, 2000, 4000] },
    );
    await tick();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    good.end();
    await tick();
    // The backoff restarted: the next wait is the first delay again, not 4000.
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    close();
  });

  it("caps the backoff at the last delay", async () => {
    const { fetchMock, close } = watch(
      [new TypeError("x"), new TypeError("x"), new TypeError("x"), new TypeError("x")],
      { delays: [100, 200] },
    );
    await tick();
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(199);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    close();
  });

  it.each([401, 403])("calls onUnauthorized on %i and does not retry", async (status) => {
    const onUnauthorized = vi.fn();
    const { fetchMock, statuses } = watch([new Response("no", { status })], { onUnauthorized });
    await vi.advanceTimersByTimeAsync(60000);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(statuses).toEqual([]);
  });

  it("does not call onUnauthorized when no token was sent, and still stops", async () => {
    const onUnauthorized = vi.fn();
    const { fetchMock } = watch([new Response("no", { status: 401 })], {
      onUnauthorized,
      token: null,
    });
    await vi.advanceTimersByTimeAsync(60000);
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the stream when a listener throws", async () => {
    const s = streamResponse();
    const { fetchMock, events, statuses, close } = watch([s.response], {
      onEvent: () => {
        throw new Error("listener bug");
      },
    });
    await tick();
    s.push(sse(closedEvent) + sse(settled));
    await tick();
    expect(events).toEqual([closedEvent, settled]);
    expect(statuses).toEqual(["connected"]);
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    close();
  });

  it.each([429, 500])("retries after a %i", async (status) => {
    const s = streamResponse();
    const onUnauthorized = vi.fn();
    const { fetchMock, statuses, close } = watch([new Response("busy", { status }), s.response], {
      onUnauthorized,
    });
    await tick();
    expect(statuses).toEqual(["reconnecting"]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(statuses).toEqual(["reconnecting", "connected"]);
    expect(onUnauthorized).not.toHaveBeenCalled();
    close();
  });

  it("aborts the in-flight fetch on close, stops retrying, and close is idempotent", async () => {
    const s = streamResponse();
    const { fetchMock, statuses, close } = watch([s.response, new TypeError("x")]);
    await tick();
    const signal = fetchMock.mock.calls[0]?.[1]?.signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    close();
    close();
    expect(signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(statuses).toEqual(["connected"]);
  });

  it("stops a pending retry when closed while waiting", async () => {
    const { fetchMock, close } = watch([new TypeError("x"), new TypeError("x")]);
    await tick();
    close();
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
