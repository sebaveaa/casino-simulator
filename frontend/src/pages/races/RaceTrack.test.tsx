import { act, cleanup, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RaceTrack } from "./RaceTrack";
import type { TrackScene } from "./trackScene";

const mocks = vi.hoisted(() => ({ create: vi.fn(), reduced: vi.fn() }));
vi.mock("./trackScene", () => ({ createTrackScene: mocks.create }));
vi.mock("../roulette/motion", () => ({ prefersReducedMotion: mocks.reduced }));

const ORDER = [2, 0, 4, 1, 3];

function fakeScene() {
  const frames = new Set<() => void>();
  const scene = {
    setPositions: vi.fn(),
    onFrame: vi.fn((frame: () => void) => {
      frames.add(frame);
      return () => frames.delete(frame);
    }),
    destroy: vi.fn(),
  } satisfies TrackScene;
  return { scene, frames, tick: () => for_each(frames) };
}
function for_each(frames: Set<() => void>) {
  for (const f of [...frames]) f();
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  mocks.reduced.mockReturnValue(false);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("RaceTrack with a working scene", () => {
  it("is idle with all animals at the start when there is no order", async () => {
    const fake = fakeScene();
    mocks.create.mockResolvedValue(fake.scene);
    const onFinish = vi.fn();
    render(<RaceTrack order={null} startedAtMs={null} durationMs={8000} onFinish={onFinish} />);
    await flush();
    expect(fake.scene.setPositions).toHaveBeenLastCalledWith([0, 0, 0, 0, 0]);
    expect(fake.frames.size).toBe(0);
    expect(onFinish).not.toHaveBeenCalled();
    expect(screen.getByRole("region").getAttribute("aria-label")).toMatch(/carreras/i);
  });

  it("animates from the clock and calls onFinish once at the end", async () => {
    const fake = fakeScene();
    mocks.create.mockResolvedValue(fake.scene);
    let t = 1000;
    const onFinish = vi.fn();
    render(
      <RaceTrack
        order={ORDER}
        startedAtMs={1000}
        durationMs={8000}
        now={() => t}
        onFinish={onFinish}
      />,
    );
    await flush();
    expect(fake.frames.size).toBe(1);
    t = 5000;
    act(() => fake.tick());
    const mid = fake.scene.setPositions.mock.calls.at(-1)?.[0] as number[];
    expect(mid.every((p) => p > 0 && p < 1)).toBe(true);
    expect(onFinish).not.toHaveBeenCalled();
    t = 20_000;
    act(() => fake.tick());
    expect(fake.scene.setPositions).toHaveBeenLastCalledWith([1, 1, 1, 1, 1]);
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(fake.frames.size).toBe(0);
  });

  it("resets and animates again for a second race, calling onFinish for each", async () => {
    const fake = fakeScene();
    mocks.create.mockResolvedValue(fake.scene);
    let t = 1000;
    const onFinish = vi.fn();
    const props = { durationMs: 8000, now: () => t, onFinish };
    const { rerender } = render(<RaceTrack order={ORDER} startedAtMs={1000} {...props} />);
    await flush();
    t = 20_000;
    act(() => fake.tick());
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(fake.frames.size).toBe(0);

    // The next round: a new order and start time. The cars go back to the line and run again.
    const nextOrder = [0, 1, 2, 3, 4];
    t = 30_000;
    rerender(<RaceTrack order={nextOrder} startedAtMs={30_000} {...props} />);
    expect(fake.frames.size).toBe(1);
    act(() => fake.tick());
    expect(fake.scene.setPositions).toHaveBeenLastCalledWith([0, 0, 0, 0, 0]);
    expect(onFinish).toHaveBeenCalledTimes(1);

    t = 50_000;
    act(() => fake.tick());
    expect(fake.scene.setPositions).toHaveBeenLastCalledWith([1, 1, 1, 1, 1]);
    expect(onFinish).toHaveBeenCalledTimes(2);
    expect(fake.frames.size).toBe(0);
  });

  it("starts the race when the order arrives after mount", async () => {
    const fake = fakeScene();
    mocks.create.mockResolvedValue(fake.scene);
    let t = 1000;
    const onFinish = vi.fn();
    const props = { durationMs: 8000, now: () => t, onFinish };
    const { rerender } = render(<RaceTrack order={null} startedAtMs={null} {...props} />);
    await flush();
    expect(fake.frames.size).toBe(0);

    rerender(<RaceTrack order={ORDER} startedAtMs={1000} {...props} />);
    expect(fake.frames.size).toBe(1);
    t = 5000;
    act(() => fake.tick());
    expect(onFinish).not.toHaveBeenCalled();
    t = 20_000;
    act(() => fake.tick());
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("shows the final positions at once for a late joiner", async () => {
    const fake = fakeScene();
    mocks.create.mockResolvedValue(fake.scene);
    const onFinish = vi.fn();
    render(
      <RaceTrack
        order={ORDER}
        startedAtMs={0}
        durationMs={8000}
        now={() => 60_000}
        onFinish={onFinish}
      />,
    );
    await flush();
    expect(fake.scene.setPositions).toHaveBeenLastCalledWith([1, 1, 1, 1, 1]);
    expect(fake.frames.size).toBe(0);
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("skips the animation with reduced motion", async () => {
    mocks.reduced.mockReturnValue(true);
    const fake = fakeScene();
    mocks.create.mockResolvedValue(fake.scene);
    const onFinish = vi.fn();
    render(
      <RaceTrack
        order={ORDER}
        startedAtMs={1000}
        durationMs={8000}
        now={() => 1000}
        onFinish={onFinish}
      />,
    );
    await flush();
    expect(fake.scene.onFrame).not.toHaveBeenCalled();
    expect(fake.scene.setPositions).toHaveBeenLastCalledWith([1, 1, 1, 1, 1]);
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("destroys the scene on unmount, also under StrictMode", async () => {
    const scenes: ReturnType<typeof fakeScene>[] = [];
    mocks.create.mockImplementation(async () => {
      const fake = fakeScene();
      scenes.push(fake);
      return fake.scene;
    });
    const view = render(
      <StrictMode>
        <RaceTrack order={null} startedAtMs={null} durationMs={8000} />
      </StrictMode>,
    );
    await flush();
    view.unmount();
    expect(scenes.length).toBeGreaterThan(0);
    for (const s of scenes) expect(s.scene.destroy).toHaveBeenCalledTimes(1);
  });
});

describe("RaceTrack without WebGL", () => {
  beforeEach(() => {
    mocks.create.mockRejectedValue(new Error("no webgl"));
  });

  it("lists the arrival order in Spanish and calls onFinish once", async () => {
    const onFinish = vi.fn();
    const { rerender } = render(
      <RaceTrack order={ORDER} startedAtMs={0} durationMs={8000} onFinish={onFinish} />,
    );
    await flush();
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual(["Zorro", "Tortuga", "Guepardo", "Conejo", "Caballo"]);
    expect(onFinish).toHaveBeenCalledTimes(1);
    rerender(<RaceTrack order={ORDER} startedAtMs={0} durationMs={8000} onFinish={onFinish} />);
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("shows no list while the order is unknown", async () => {
    const onFinish = vi.fn();
    render(<RaceTrack order={null} startedAtMs={null} durationMs={8000} onFinish={onFinish} />);
    await flush();
    expect(screen.queryByRole("list")).toBeNull();
    expect(onFinish).not.toHaveBeenCalled();
  });
});
