import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startLoop } from "./loop";

describe("startLoop", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs a tick right away and then once per interval after each tick ends", async () => {
    const tick = vi.fn(async () => {});
    const loop = startLoop(tick, { intervalMs: 1000, onError: () => {} });

    await vi.advanceTimersByTimeAsync(0);
    expect(tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(tick).toHaveBeenCalledTimes(2);

    await loop.stop();
  });

  it("never overlaps ticks: the next one waits for a slow tick to finish", async () => {
    let running = 0;
    let maxRunning = 0;
    const tick = vi.fn(async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((resolve) => setTimeout(resolve, 2500));
      running--;
    });
    const loop = startLoop(tick, { intervalMs: 1000, onError: () => {} });

    await vi.advanceTimersByTimeAsync(10_000);
    expect(maxRunning).toBe(1);
    // Each cycle is 2500 ms of work plus the 1000 ms pause.
    expect(tick).toHaveBeenCalledTimes(3);

    const stopped = loop.stop();
    await vi.advanceTimersByTimeAsync(2500);
    await stopped;
  });

  it("reports a failed tick and keeps going", async () => {
    const onError = vi.fn();
    const failure = new Error("tick failed");
    const tick = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(undefined);
    const loop = startLoop(tick, { intervalMs: 1000, onError });

    await vi.advanceTimersByTimeAsync(2000);
    expect(onError).toHaveBeenCalledWith(failure);
    expect(tick).toHaveBeenCalledTimes(3);

    await loop.stop();
  });

  it("stop waits for the tick in flight and schedules no more", async () => {
    let finishTick: () => void = () => {};
    const tick = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishTick = resolve;
        }),
    );
    const loop = startLoop(tick, { intervalMs: 1000, onError: () => {} });
    await vi.advanceTimersByTimeAsync(0);
    expect(tick).toHaveBeenCalledTimes(1);

    let stopped = false;
    const stopping = loop.stop().then(() => {
      stopped = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(false);

    finishTick();
    await stopping;
    expect(stopped).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(tick).toHaveBeenCalledTimes(1);
  });
});
