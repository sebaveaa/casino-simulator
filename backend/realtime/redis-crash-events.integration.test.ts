import { randomUUID } from "node:crypto";
import { type CrashEvent, crashEventSchema } from "@casino/shared";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRedisCrashEventBus } from "./redis-crash-events";

const url = process.env.TEST_REDIS_URL;

/**
 * The channel is shared, so other files or runs may publish on it too: every assertion filters on a
 * roundId unique to the test.
 */
describe.skipIf(!url)("createRedisCrashEventBus (Redis)", () => {
  const extraClients: Redis[] = [];
  const discarded: Error[] = [];

  const newClient = () => {
    const client = new Redis(url as string);
    extraClients.push(client);
    return client;
  };
  const newBus = () =>
    createRedisCrashEventBus(newClient(), { onError: (error) => discarded.push(error) });

  beforeAll(() => {});
  afterAll(async () => {
    await Promise.all(extraClients.map((c) => c.quit().catch(() => undefined)));
  });

  async function until(condition: () => Promise<boolean> | boolean, what: string) {
    for (let i = 0; i < 100; i++) {
      if (await condition()) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`Timed out waiting for ${what}`);
  }

  it("delivers a game's event across buses and withholds it from the other game", async () => {
    const sender = newBus();
    const receiver = newBus();
    const roundId = randomUUID();
    const event: CrashEvent = { type: "settled", roundId };
    const dino: CrashEvent[] = [];
    const aviator: CrashEvent[] = [];
    const offDino = receiver.subscribe("dino-crash", (e) => {
      if ("roundId" in e && e.roundId === roundId) dino.push(e);
    });
    const offAviator = receiver.subscribe("aviator", (e) => {
      if ("roundId" in e && e.roundId === roundId) aviator.push(e);
    });

    await until(async () => {
      await sender.publish("dino-crash", event);
      return dino.length > 0;
    }, "event delivery");
    expect(crashEventSchema.safeParse(dino[0]).success).toBe(true);
    expect(dino[0]).toEqual(event);
    expect(aviator).toHaveLength(0);

    offDino();
    offAviator();
    await sender.close();
    await receiver.close();
  });

  it("close() is idempotent", async () => {
    const bus = newBus();
    bus.subscribe("dino-crash", () => {});
    await bus.close();
    await bus.close();
  });
});
