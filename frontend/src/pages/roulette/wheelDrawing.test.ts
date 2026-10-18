import { afterEach, describe, expect, it, vi } from "vitest";
import { loadWheelFonts } from "./wheelDrawing";

function stubFonts(load: () => Promise<unknown>) {
  Object.defineProperty(document, "fonts", { configurable: true, value: { load } });
}

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(document, "fonts");
});

describe("loadWheelFonts", () => {
  it("waits for the font when it loads", async () => {
    const load = vi.fn(() => Promise.resolve([]));
    stubFonts(load);
    await loadWheelFonts();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("gives up after the timeout when the font never settles", async () => {
    vi.useFakeTimers();
    stubFonts(() => new Promise(() => {}));
    let done = false;
    void loadWheelFonts(1500).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(1499);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
  });

  it("resolves when the font fails to load", async () => {
    stubFonts(() => Promise.reject(new Error("offline")));
    await expect(loadWheelFonts()).resolves.toBeUndefined();
  });
});
