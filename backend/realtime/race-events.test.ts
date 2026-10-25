import type { RaceEvent } from "@casino/shared";
import { describe, expect, it } from "vitest";
import { createMemoryRaceEventBus } from "./race-events";

const closed: RaceEvent = { type: "closed", roundId: "00000000-0000-4000-8000-000000000001" };
const settled: RaceEvent = { type: "settled", roundId: "00000000-0000-4000-8000-000000000001" };

describe("createMemoryRaceEventBus", () => {
  it("delivers each event to every current subscriber", async () => {
    const bus = createMemoryRaceEventBus();
    const first: RaceEvent[] = [];
    const second: RaceEvent[] = [];
    bus.subscribe((event) => first.push(event));
    bus.subscribe((event) => second.push(event));

    await bus.publish(closed);

    expect(first).toEqual([closed]);
    expect(second).toEqual([closed]);
  });

  it("stops delivering to a listener once it unsubscribes", async () => {
    const bus = createMemoryRaceEventBus();
    const received: RaceEvent[] = [];
    const unsubscribe = bus.subscribe((event) => received.push(event));

    await bus.publish(closed);
    unsubscribe();
    await bus.publish(settled);

    expect(received).toEqual([closed]);
  });

  it("publishes with no subscribers", async () => {
    await expect(createMemoryRaceEventBus().publish(closed)).resolves.toBeUndefined();
  });
});
