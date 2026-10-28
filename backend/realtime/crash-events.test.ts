import type { CrashEvent } from "@casino/shared";
import { describe, expect, it, vi } from "vitest";
import { createMemoryCrashEventBus } from "./crash-events";

const settled: CrashEvent = { type: "settled", roundId: "11111111-1111-4111-8111-111111111111" };

describe("createMemoryCrashEventBus", () => {
  it("delivers an event to every listener of that game", async () => {
    const bus = createMemoryCrashEventBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.subscribe("dino-crash", a);
    bus.subscribe("dino-crash", b);
    await bus.publish("dino-crash", settled);
    expect(a).toHaveBeenCalledWith(settled);
    expect(b).toHaveBeenCalledWith(settled);
  });

  it("keeps the two games apart", async () => {
    const bus = createMemoryCrashEventBus();
    const dino = vi.fn();
    const aviator = vi.fn();
    bus.subscribe("dino-crash", dino);
    bus.subscribe("aviator", aviator);
    await bus.publish("aviator", settled);
    expect(aviator).toHaveBeenCalledWith(settled);
    expect(dino).not.toHaveBeenCalled();
  });

  it("stops delivery after unsubscribe", async () => {
    const bus = createMemoryCrashEventBus();
    const listener = vi.fn();
    const off = bus.subscribe("dino-crash", listener);
    off();
    await bus.publish("dino-crash", settled);
    expect(listener).not.toHaveBeenCalled();
  });

  it("subscribing the same function twice yields two independent subscriptions", async () => {
    const bus = createMemoryCrashEventBus();
    const listener = vi.fn();
    const off1 = bus.subscribe("dino-crash", listener);
    bus.subscribe("dino-crash", listener);
    off1();
    await bus.publish("dino-crash", settled);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
