import { apiPaths, type RaceEvent, raceEventSchema } from "@casino/shared";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type AuthUser, InvalidTokenError, type TokenService } from "../auth/token-service";
import type { Db } from "../db/database";
import { buildApp } from "../platform/app";
import type { ModuleRoutes } from "../platform/routes";
import { stubServices } from "../platform/services";
import { createMemoryRaceEventBus, type RaceEventBus } from "./race-events";
import { createStreamRoutes, MAX_STREAMS_PER_USER } from "./stream-routes";

const config = {
  appEnv: "production" as const,
  allowedOrigins: ["http://localhost:8080"],
  raceDurationMs: 10_000,
  raceIntermissionMs: 8000,
  raceMinStake: 10n,
  raceMaxStake: 500n,
};
const checks = { postgres: async () => true, redis: async () => true };
const alice = "11111111-1111-4111-8111-111111111111";
const bob = "33333333-3333-4333-8333-333333333333";
const roundId = "22222222-2222-4222-8222-222222222222";

function fakeTokens(known: string[]): TokenService {
  return {
    sign: async () => "token",
    verify: async (token): Promise<AuthUser> => {
      if (!known.includes(token)) throw new InvalidTokenError();
      return { id: token, role: "player" };
    },
  };
}

const openedEvent: RaceEvent = {
  type: "opened",
  round: {
    id: roundId,
    status: "open",
    opensAt: "2026-10-19T10:00:00.000Z",
    closesAt: "2026-10-19T10:00:30.000Z",
    serverSeedHash: "a".repeat(64),
  },
};

/** A memory bus that counts live subscriptions and can publish without validation. */
function countingBus() {
  const inner = createMemoryRaceEventBus();
  const state = { subscribers: 0 };
  const bus: RaceEventBus = {
    publish: (event) => inner.publish(event),
    subscribe(listener) {
      state.subscribers += 1;
      const unsubscribe = inner.subscribe(listener);
      let done = false;
      return () => {
        if (!done) {
          done = true;
          state.subscribers -= 1;
        }
        unsubscribe();
      };
    },
  };
  return { bus, state };
}

const apps: FastifyInstance[] = [];
const clients: AbortController[] = [];
afterEach(async () => {
  for (const client of clients.splice(0)) client.abort();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function until(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** A logger that records warnings, to check what is logged. */
function recordingLogger() {
  const warn = vi.fn();
  const noop = () => {};
  const logger = {
    level: "info",
    info: noop,
    error: noop,
    debug: noop,
    fatal: noop,
    trace: noop,
    silent: noop,
    warn,
    child: () => logger,
  } as unknown as FastifyBaseLogger;
  return { logger, warn };
}

async function start(
  options: Parameters<typeof createStreamRoutes>[0] = {},
  extra: { logger?: FastifyBaseLogger; routes?: ModuleRoutes[] } = {},
) {
  const { bus, state } = countingBus();
  const app = await buildApp({
    logger: extra.logger,
    config,
    checks,
    db: {} as Db,
    services: { ...stubServices, tokens: fakeTokens([alice, bob]), raceEvents: bus },
    routes: [...(extra.routes ?? []), createStreamRoutes({ heartbeatMs: 20, ...options })],
  });
  apps.push(app);
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (typeof address === "string" || address === null) throw new Error("no address");
  return { app, bus, state, url: `http://127.0.0.1:${address.port}${apiPaths.raceStream}` };
}

type Client = { status: number; response: Response; text: () => string; close: () => void };

/** Opens a stream and accumulates everything it receives. */
async function open(url: string, headers: Record<string, string> = {}): Promise<Client> {
  const controller = new AbortController();
  clients.push(controller);
  const response = await fetch(url, { headers, signal: controller.signal });
  let received = "";
  if (response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    void (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return;
          received += decoder.decode(value, { stream: true });
        }
      } catch {
        // Aborted by the test.
      }
    })();
  }
  return {
    status: response.status,
    response,
    text: () => received,
    close: () => controller.abort(),
  };
}

const as = (user: string) => ({ authorization: `Bearer ${user}` });

function dataEvents(text: string): unknown[] {
  return text
    .split("\n\n")
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => JSON.parse(chunk.slice("data: ".length)));
}

describe("race event stream", () => {
  it("rejects a request without a token with a 401 JSON error", async () => {
    const { url } = await start();
    const response = await fetch(url);
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "unauthorized",
    );
  });

  it("opens an event stream and announces it", async () => {
    const { url } = await start();
    const client = await open(url, as(alice));
    expect(client.status).toBe(200);
    expect(client.response.headers.get("content-type")).toContain("text/event-stream");
    expect(client.response.headers.get("cache-control")).toBe("no-cache");
    expect(client.response.headers.get("x-accel-buffering")).toBe("no");
    await until(() => client.text().includes(": connected\n\n"));
  });

  it("delivers a published event as a data line that matches the schema", async () => {
    const { url, bus, state } = await start();
    const client = await open(url, as(alice));
    await until(() => state.subscribers === 1);
    await bus.publish(openedEvent);
    await until(() => dataEvents(client.text()).length === 1);
    const [event] = dataEvents(client.text());
    expect(raceEventSchema.safeParse(event).success).toBe(true);
    expect(event).toEqual(openedEvent);
  });

  it("drops an event that fails the schema", async () => {
    const { url, bus, state } = await start();
    const client = await open(url, as(alice));
    await until(() => state.subscribers === 1);
    await bus.publish({ type: "bogus" } as unknown as RaceEvent);
    await bus.publish({ type: "closed", roundId: "not-a-uuid" } as RaceEvent);
    await bus.publish({ type: "settled", roundId });
    await until(() => dataEvents(client.text()).length === 1);
    expect(dataEvents(client.text())).toEqual([{ type: "settled", roundId }]);
  });

  it("logs a dropped event at warn level without its body or any seed", async () => {
    const { logger, warn } = recordingLogger();
    const { url, bus, state } = await start({}, { logger });
    const client = await open(url, as(alice));
    await until(() => state.subscribers === 1);
    await bus.publish({
      type: "closed",
      roundId,
      serverSeed: "secret-seed",
    } as unknown as RaceEvent);
    await bus.publish({ type: "settled", roundId: "not-a-uuid" } as RaceEvent);
    await bus.publish({ type: "settled", roundId });
    await until(() => dataEvents(client.text()).length === 1);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret-seed");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("not-a-uuid");
  });

  it("does not leak a slot when writeHead throws", async () => {
    let failing = true;
    const breakWriteHead: ModuleRoutes = async (app) => {
      app.addHook("onRequest", async (_request, reply) => {
        if (!failing) return;
        reply.raw.writeHead = () => {
          throw new Error("writeHead failed");
        };
      });
    };
    const { logger, warn } = recordingLogger();
    const { url } = await start({}, { logger, routes: [breakWriteHead] });
    for (let i = 0; i < MAX_STREAMS_PER_USER + 1; i++) {
      await fetch(url, { headers: as(alice) }).catch(() => undefined);
    }
    expect(warn).toHaveBeenCalledTimes(MAX_STREAMS_PER_USER + 1);

    failing = false;
    const client = await open(url, as(alice));
    expect(client.status).toBe(200);
  });

  it("never writes a serverSeed in an opened or closed event", async () => {
    const { url, bus, state } = await start();
    const client = await open(url, as(alice));
    await until(() => state.subscribers === 1);
    await bus.publish({
      type: "opened",
      round: { ...openedEvent.round, serverSeed: "secret-seed" },
    } as unknown as RaceEvent);
    await bus.publish({
      type: "closed",
      roundId,
      serverSeed: "secret-seed",
    } as unknown as RaceEvent);
    await bus.publish(openedEvent);
    await until(() => dataEvents(client.text()).length >= 1);
    // The sentinel event arrives last, so anything earlier would already be in the text.
    expect(dataEvents(client.text())).toEqual([openedEvent]);
    expect(client.text()).not.toMatch(/"serverSeed"/);
    expect(client.text()).not.toContain("secret-seed");
  });

  it("sends heartbeat comments", async () => {
    const { url } = await start({ heartbeatMs: 10 });
    const client = await open(url, as(alice));
    await until(() => client.text().includes(": ping\n\n"));
  });

  it("answers the fourth concurrent stream of a user with 429, but not another user", async () => {
    const { url } = await start();
    for (let i = 0; i < MAX_STREAMS_PER_USER; i++) {
      expect((await open(url, as(alice))).status).toBe(200);
    }
    const rejected = await fetch(url, { headers: as(alice) });
    expect(rejected.status).toBe(429);
    expect(((await rejected.json()) as { error: { code: string } }).error.code).toBe(
      "invalid_request",
    );
    expect((await open(url, as(bob))).status).toBe(200);
  });

  it("frees the slot and unsubscribes when a client closes", async () => {
    const { url, state } = await start();
    const clientsOpen: Client[] = [];
    for (let i = 0; i < MAX_STREAMS_PER_USER; i++) clientsOpen.push(await open(url, as(alice)));
    await until(() => state.subscribers === MAX_STREAMS_PER_USER);

    clientsOpen[0]?.close();
    await until(() => state.subscribers === MAX_STREAMS_PER_USER - 1);

    const next = await open(url, as(alice));
    expect(next.status).toBe(200);
    await until(() => state.subscribers === MAX_STREAMS_PER_USER);
  });

  it("carries the CORS headers for an allowed origin", async () => {
    const { url } = await start();
    const origin = "http://localhost:8080";
    const client = await open(url, { ...as(alice), origin });
    expect(client.status).toBe(200);
    expect(client.response.headers.get("access-control-allow-origin")).toBe(origin);
  });

  it("lets the app close while a stream is open", async () => {
    const { app, state } = await start();
    const url = `http://127.0.0.1:${(app.server.address() as { port: number }).port}${apiPaths.raceStream}`;
    await open(url, as(alice));
    await until(() => state.subscribers === 1);
    await app.close();
    expect(state.subscribers).toBe(0);
  });
});
