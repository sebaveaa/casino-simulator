import { EventEmitter } from "node:events";
import type { RaceEvent } from "@casino/shared";
import type { Redis } from "ioredis";
import { describe, expect, it, vi } from "vitest";
import { createRedisRaceEventBus, RACE_CHANNEL } from "./redis-race-events";

class FakeSubscriber extends EventEmitter {
  subscribe = vi.fn(async (..._channels: string[]) => 1);
  unsubscribe = vi.fn(async (..._channels: string[]) => 0);
  disconnect = vi.fn();
}

function setup() {
  const subscribers: FakeSubscriber[] = [];
  const publisher = {
    publish: vi.fn(async (_channel: string, _message: string) => 1),
    duplicate: vi.fn(() => {
      const subscriber = new FakeSubscriber();
      subscribers.push(subscriber);
      return subscriber;
    }),
  };
  const onError = vi.fn();
  const bus = createRedisRaceEventBus(publisher as unknown as Redis, { onError });
  return { bus, publisher, subscribers, onError };
}

const settled: RaceEvent = { type: "settled", roundId: "11111111-1111-4111-8111-111111111111" };

describe("createRedisRaceEventBus (fake connections)", () => {
  it("publishes the JSON event on the races channel", async () => {
    const { bus, publisher } = setup();
    await bus.publish(settled);
    expect(publisher.publish).toHaveBeenCalledWith(RACE_CHANNEL, JSON.stringify(settled));
  });

  it("rejects when the publish fails", async () => {
    const { bus, publisher } = setup();
    publisher.publish.mockRejectedValueOnce(new Error("Stream isn't writeable"));
    await expect(bus.publish(settled)).rejects.toThrow("Stream isn't writeable");
  });

  it("creates one subscriber on the first listener and subscribes once", () => {
    const { bus, publisher, subscribers } = setup();
    expect(publisher.duplicate).not.toHaveBeenCalled();
    bus.subscribe(() => {});
    bus.subscribe(() => {});
    expect(publisher.duplicate).toHaveBeenCalledTimes(1);
    expect(subscribers[0]?.subscribe).toHaveBeenCalledTimes(1);
    expect(subscribers[0]?.subscribe).toHaveBeenCalledWith(RACE_CHANNEL);
  });

  it("delivers a valid message to every listener", () => {
    const { bus, subscribers } = setup();
    const a = vi.fn();
    const b = vi.fn();
    bus.subscribe(a);
    bus.subscribe(b);
    subscribers[0]?.emit("message", RACE_CHANNEL, JSON.stringify(settled));
    expect(a).toHaveBeenCalledWith(settled);
    expect(b).toHaveBeenCalledWith(settled);
  });

  it("discards malformed JSON and schema failures without throwing", () => {
    const { bus, subscribers, onError } = setup();
    const listener = vi.fn();
    bus.subscribe(listener);
    const subscriber = subscribers[0] as FakeSubscriber;
    expect(() => subscriber.emit("message", RACE_CHANNEL, "{not json")).not.toThrow();
    expect(() =>
      subscriber.emit("message", RACE_CHANNEL, JSON.stringify({ type: "nope" })),
    ).not.toThrow();
    expect(listener).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(2);
    subscriber.emit("message", RACE_CHANNEL, JSON.stringify(settled));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("keeps delivering when a listener throws", () => {
    const { bus, subscribers } = setup();
    const good = vi.fn();
    bus.subscribe(() => {
      throw new Error("boom");
    });
    bus.subscribe(good);
    expect(() =>
      subscribers[0]?.emit("message", RACE_CHANNEL, JSON.stringify(settled)),
    ).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
  });

  it("disconnects the subscriber only when the last listener leaves", () => {
    const { bus, subscribers } = setup();
    const off1 = bus.subscribe(() => {});
    const off2 = bus.subscribe(() => {});
    const subscriber = subscribers[0] as FakeSubscriber;
    off1();
    off1();
    expect(subscriber.disconnect).not.toHaveBeenCalled();
    off2();
    expect(subscriber.unsubscribe).toHaveBeenCalledWith(RACE_CHANNEL);
    expect(subscriber.disconnect).toHaveBeenCalledTimes(1);
  });

  it("creates a fresh subscriber after the previous one was torn down", () => {
    const { bus, subscribers } = setup();
    bus.subscribe(() => {})();
    bus.subscribe(() => {});
    expect(subscribers).toHaveLength(2);
  });

  it("close() disconnects the subscriber and is idempotent", async () => {
    const { bus, subscribers } = setup();
    bus.subscribe(() => {});
    await bus.close();
    await bus.close();
    expect(subscribers[0]?.disconnect).toHaveBeenCalledTimes(1);
  });
});
