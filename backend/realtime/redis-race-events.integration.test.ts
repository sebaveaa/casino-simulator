import { randomUUID } from "node:crypto";
import { type RaceEvent, raceEventSchema } from "@casino/shared";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRedisRaceEventBus, RACE_CHANNEL } from "./redis-race-events";

const url = process.env.TEST_REDIS_URL;

/**
 * The channel is shared, so other files or runs may publish on it too: every assertion filters
 * on a roundId unique to the test.
 */
describe.skipIf(!url)("createRedisRaceEventBus (Redis)", () => {
  let publisher: Redis;
  let probe: Redis;
  const extraClients: Redis[] = [];
  const discarded: Error[] = [];

  const newClient = () => {
    const client = new Redis(url as string);
    extraClients.push(client);
    return client;
  };
  const newBus = (client = newClient()) =>
    createRedisRaceEventBus(client, { onError: (error) => discarded.push(error) });

  beforeAll(() => {
    publisher = newClient();
    probe = newClient();
  });

  afterAll(async () => {
    await Promise.all(extraClients.map((c) => c.quit().catch(() => undefined)));
  });

  const subscriberCount = async () => {
    const counts = (await probe.pubsub("NUMSUB", RACE_CHANNEL)) as [string, number];
    return Number(counts[1]);
  };

  /** The count once earlier tests' disconnects have been processed by the server. */
  async function quietCount() {
    let last = await subscriberCount();
    for (let i = 0; i < 100; i++) {
      await new Promise((r) => setTimeout(r, 30));
      const next = await subscriberCount();
      if (next === last) return next;
      last = next;
    }
    throw new Error("The subscriber count never settled");
  }

  /** Subscribing is synchronous but the SUBSCRIBE command is asynchronous. */
  async function until(condition: () => Promise<boolean> | boolean, what: string) {
    for (let i = 0; i < 100; i++) {
      if (await condition()) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`Timed out waiting for ${what}`);
  }

  const settledEvent = (roundId = randomUUID()): RaceEvent => ({ type: "settled", roundId });
  const collect = (bus: ReturnType<typeof newBus>, roundId: string) => {
    const received: RaceEvent[] = [];
    const off = bus.subscribe((event) => {
      if ("roundId" in event && event.roundId === roundId) received.push(event);
    });
    return { received, off };
  };

  it("delivers an event published by one bus to a listener on another", async () => {
    const sender = newBus();
    const receiver = newBus();
    const event = settledEvent();
    const { received, off } = collect(receiver, (event as { roundId: string }).roundId);
    // Publishes until the receiver's SUBSCRIBE has landed.
    await until(async () => {
      await sender.publish(event);
      return received.length > 0;
    }, "event delivery");
    expect(received[0]).toEqual(event);
    expect(raceEventSchema.safeParse(received[0]).success).toBe(true);
    off();
    await sender.close();
    await receiver.close();
  });

  it("fans out to two local listeners and disconnects after both leave", async () => {
    const before = await quietCount();
    const bus = newBus();
    const roundId = randomUUID();
    const first = collect(bus, roundId);
    const second = collect(bus, roundId);
    await until(async () => (await subscriberCount()) === before + 1, "one subscription");

    await bus.publish({ type: "closed", roundId });
    await until(() => first.received.length === 1 && second.received.length === 1, "fan-out");

    first.off();
    await bus.publish({ type: "settled", roundId });
    await until(() => second.received.length === 2, "second listener keeps receiving");
    expect(first.received).toHaveLength(1);

    second.off();
    await until(async () => (await subscriberCount()) === before, "subscriber disconnected");
  });

  it("discards garbage on the channel and keeps delivering valid events", async () => {
    const bus = newBus();
    const roundId = randomUUID();
    const { received, off } = collect(bus, roundId);
    await until(async () => (await subscriberCount()) >= 1, "subscription");
    const errorsBefore = discarded.length;

    await until(async () => {
      await publisher.publish(RACE_CHANNEL, "{not json");
      return discarded.length > errorsBefore;
    }, "garbage discarded");
    await publisher.publish(RACE_CHANNEL, JSON.stringify({ type: "bogus" }));

    await until(async () => {
      await bus.publish({ type: "settled", roundId });
      return received.length > 0;
    }, "valid event after garbage");
    expect(received.every((e) => raceEventSchema.safeParse(e).success)).toBe(true);
    off();
    await bus.close();
  });

  it("close() leaves nothing connected and is idempotent", async () => {
    const before = await quietCount();
    const bus = newBus();
    bus.subscribe(() => {});
    await until(async () => (await subscriberCount()) === before + 1, "subscription");
    await bus.close();
    await bus.close();
    await until(async () => (await subscriberCount()) === before, "subscriber disconnected");
  });
});
