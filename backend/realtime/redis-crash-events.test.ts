import { EventEmitter } from "node:events";
import type { CrashEvent } from "@casino/shared";
import type { Redis } from "ioredis";
import { describe, expect, it, vi } from "vitest";
import { CRASH_CHANNEL, createRedisCrashEventBus } from "./redis-crash-events";

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
  const bus = createRedisCrashEventBus(publisher as unknown as Redis, { onError });
  return { bus, publisher, subscribers, onError };
}

const settled: CrashEvent = { type: "settled", roundId: "11111111-1111-4111-8111-111111111111" };
const envelope = (game: string, event: unknown) => JSON.stringify({ game, event });

describe("createRedisCrashEventBus (fake connections)", () => {
  it("publishes the game and event as an envelope on the crash channel", async () => {
    const { bus, publisher } = setup();
    await bus.publish("dino-crash", settled);
    expect(publisher.publish).toHaveBeenCalledWith(CRASH_CHANNEL, envelope("dino-crash", settled));
  });

  it("creates one subscriber on the first listener and subscribes once", () => {
    const { bus, publisher, subscribers } = setup();
    expect(publisher.duplicate).not.toHaveBeenCalled();
    bus.subscribe("dino-crash", () => {});
    bus.subscribe("aviator", () => {});
    expect(publisher.duplicate).toHaveBeenCalledTimes(1);
    expect(subscribers[0]?.subscribe).toHaveBeenCalledWith(CRASH_CHANNEL);
  });

  it("delivers a valid message only to listeners of its game", () => {
    const { bus, subscribers } = setup();
    const dino = vi.fn();
    const aviator = vi.fn();
    bus.subscribe("dino-crash", dino);
    bus.subscribe("aviator", aviator);
    subscribers[0]?.emit("message", CRASH_CHANNEL, envelope("dino-crash", settled));
    expect(dino).toHaveBeenCalledWith(settled);
    expect(aviator).not.toHaveBeenCalled();
  });

  it("discards malformed JSON, bad games and schema failures without throwing", () => {
    const { bus, subscribers, onError } = setup();
    const listener = vi.fn();
    bus.subscribe("dino-crash", listener);
    const subscriber = subscribers[0] as FakeSubscriber;
    expect(() => subscriber.emit("message", CRASH_CHANNEL, "{not json")).not.toThrow();
    expect(() =>
      subscriber.emit("message", CRASH_CHANNEL, envelope("nope", settled)),
    ).not.toThrow();
    expect(() =>
      subscriber.emit("message", CRASH_CHANNEL, envelope("dino-crash", { type: "nope" })),
    ).not.toThrow();
    expect(listener).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(3);
    subscriber.emit("message", CRASH_CHANNEL, envelope("dino-crash", settled));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("disconnects the subscriber only when the last listener of any game leaves", () => {
    const { bus, subscribers } = setup();
    const off1 = bus.subscribe("dino-crash", () => {});
    const off2 = bus.subscribe("aviator", () => {});
    const subscriber = subscribers[0] as FakeSubscriber;
    off1();
    expect(subscriber.disconnect).not.toHaveBeenCalled();
    off2();
    expect(subscriber.unsubscribe).toHaveBeenCalledWith(CRASH_CHANNEL);
    expect(subscriber.disconnect).toHaveBeenCalledTimes(1);
  });

  it("close() disconnects the subscriber and is idempotent", async () => {
    const { bus, subscribers } = setup();
    bus.subscribe("dino-crash", () => {});
    await bus.close();
    await bus.close();
    expect(subscribers[0]?.disconnect).toHaveBeenCalledTimes(1);
  });
});
