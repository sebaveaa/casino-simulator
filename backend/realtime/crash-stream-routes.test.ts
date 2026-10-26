import { apiPaths, type CrashEvent, crashEventSchema } from "@casino/shared";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { type AuthUser, InvalidTokenError, type TokenService } from "../auth/token-service";
import type { Db } from "../db/database";
import { buildApp } from "../platform/app";
import { stubServices } from "../platform/services";
import { type CrashEventBus, createMemoryCrashEventBus } from "./crash-events";
import { createCrashStreamRoutes, MAX_STREAMS_PER_USER } from "./crash-stream-routes";

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
const game = "dino-crash";

function fakeTokens(known: string[]): TokenService {
  return {
    sign: async () => "token",
    verify: async (token): Promise<AuthUser> => {
      if (!known.includes(token)) throw new InvalidTokenError();
      return { id: token, role: "player" };
    },
  };
}

const openedEvent: CrashEvent = {
  type: "opened",
  round: {
    id: roundId,
    status: "open",
    opensAt: "2026-10-25T10:00:00.000Z",
    closesAt: "2026-10-25T10:00:05.000Z",
    serverSeedHash: "a".repeat(64),
  },
};

/** A memory bus that counts live subscriptions per game. */
function countingBus() {
  const inner = createMemoryCrashEventBus();
  const state = { subscribers: 0 };
  const bus: CrashEventBus = {
    publish: (g, event) => inner.publish(g, event),
    subscribe(g, listener) {
      state.subscribers += 1;
      const unsubscribe = inner.subscribe(g, listener);
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

async function start() {
  const { bus, state } = countingBus();
  const app = await buildApp({
    config,
    checks,
    db: {} as Db,
    services: { ...stubServices, tokens: fakeTokens([alice, bob]) },
    routes: [createCrashStreamRoutes({ bus, heartbeatMs: 20 })],
  });
  apps.push(app);
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (typeof address === "string" || address === null) throw new Error("no address");
  const base = `http://127.0.0.1:${address.port}`;
  const streamUrl = (g: string) => `${base}${apiPaths.crashStream.replace(":game", g)}`;
  return { app, bus, state, streamUrl };
}

type Client = { status: number; response: Response; text: () => string; close: () => void };

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

describe("crash event stream", () => {
  it("rejects a request without a token with a 401 JSON error", async () => {
    const { streamUrl } = await start();
    const response = await fetch(streamUrl(game));
    expect(response.status).toBe(401);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "unauthorized",
    );
  });

  it("rejects an unknown game with a 400 JSON error", async () => {
    const { streamUrl } = await start();
    const response = await fetch(streamUrl("not-a-game"), { headers: as(alice) });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "invalid_request",
    );
  });

  it("opens an event stream and announces it", async () => {
    const { streamUrl } = await start();
    const client = await open(streamUrl(game), as(alice));
    expect(client.status).toBe(200);
    expect(client.response.headers.get("content-type")).toContain("text/event-stream");
    await until(() => client.text().includes(": connected\n\n"));
  });

  it("delivers a published event of the game as a schema-valid data line", async () => {
    const { streamUrl, bus, state } = await start();
    const client = await open(streamUrl(game), as(alice));
    await until(() => state.subscribers === 1);
    await bus.publish(game, openedEvent);
    await until(() => dataEvents(client.text()).length === 1);
    const [event] = dataEvents(client.text());
    expect(crashEventSchema.safeParse(event).success).toBe(true);
    expect(event).toEqual(openedEvent);
  });

  it("does not deliver another game's events", async () => {
    const { streamUrl, bus, state } = await start();
    const client = await open(streamUrl(game), as(alice));
    await until(() => state.subscribers === 1);
    await bus.publish("aviator", { type: "settled", roundId });
    await bus.publish(game, { type: "settled", roundId });
    await until(() => dataEvents(client.text()).length === 1);
    expect(dataEvents(client.text())).toEqual([{ type: "settled", roundId }]);
  });

  it("drops an event that fails the schema and never writes a seed outside an impact", async () => {
    const { streamUrl, bus, state } = await start();
    const client = await open(streamUrl(game), as(alice));
    await until(() => state.subscribers === 1);
    await bus.publish(game, { type: "bogus" } as unknown as CrashEvent);
    await bus.publish(game, {
      type: "takeoff",
      roundId,
      serverSeed: "secret-seed",
    } as unknown as CrashEvent);
    await bus.publish(game, { type: "settled", roundId });
    await until(() => dataEvents(client.text()).length === 1);
    expect(dataEvents(client.text())).toEqual([{ type: "settled", roundId }]);
    expect(client.text()).not.toContain("secret-seed");
  });

  it("sends heartbeat comments", async () => {
    const { streamUrl } = await start();
    const client = await open(streamUrl(game), as(alice));
    await until(() => client.text().includes(": ping\n\n"));
  });

  it("answers the fourth concurrent stream of a user with 429, but not another user", async () => {
    const { streamUrl } = await start();
    for (let i = 0; i < MAX_STREAMS_PER_USER; i++) {
      expect((await open(streamUrl(game), as(alice))).status).toBe(200);
    }
    const rejected = await fetch(streamUrl(game), { headers: as(alice) });
    expect(rejected.status).toBe(429);
    expect((await open(streamUrl(game), as(bob))).status).toBe(200);
  });

  it("lets the app close while a stream is open", async () => {
    const { app, state, streamUrl } = await start();
    await open(streamUrl(game), as(alice));
    await until(() => state.subscribers === 1);
    await app.close();
    expect(state.subscribers).toBe(0);
  });
});
