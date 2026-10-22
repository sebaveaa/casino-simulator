import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "../roulette/motion";
import { animalName } from "./animals";
import { positionsAt, trackProgress } from "./trackMotion";
import { createTrackScene, type TrackScene } from "./trackScene";

export interface RaceTrackProps {
  /** Arrival order the server already decided (animal ids, `order[0]` wins); null before it is known. */
  order: number[] | null;
  /** Server clock time at which the race started; null while there is no race. */
  startedAtMs: number | null;
  durationMs: number;
  /** Clock used for the animation, injectable for tests. */
  now?: () => number;
  /** Called once per race when the animation ends (or is skipped). */
  onFinish?: () => void;
}

const IDLE = positionsAt([0, 1, 2, 3, 4], 0);

/** Five-lane race track drawn with PixiJS. It only animates `order`; it never decides a result. */
export function RaceTrack({
  order,
  startedAtMs,
  durationMs,
  now = Date.now,
  onFinish,
}: RaceTrackProps) {
  const host = useRef<HTMLDivElement>(null);
  const [scene, setScene] = useState<TrackScene | null>(null);
  const [failed, setFailed] = useState(false);
  const finishRef = useRef(onFinish);
  finishRef.current = onFinish;
  const nowRef = useRef(now);
  nowRef.current = now;
  const finishedFor = useRef<string | null>(null);

  // Mount once. Cleanup also covers StrictMode's mount, unmount, mount sequence.
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let cancelled = false;
    let created: TrackScene | null = null;
    createTrackScene(element).then(
      (s) => {
        if (cancelled) {
          s.destroy();
          return;
        }
        created = s;
        setScene(s);
      },
      () => {
        // No WebGL: the arrival order still shows as a list.
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
      created?.destroy();
      setScene(null);
    };
  }, []);

  const key = order ? `${order.join(",")}|${startedAtMs}` : null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for order and startedAtMs.
  useEffect(() => {
    if (key === null || !order) {
      finishedFor.current = null;
      scene?.setPositions(IDLE);
      return;
    }
    const finish = () => {
      if (finishedFor.current === key) return;
      finishedFor.current = key;
      finishRef.current?.();
    };
    if (failed) {
      finish();
      return;
    }
    if (!scene) return;
    const progressNow = () =>
      startedAtMs === null ? 1 : trackProgress(nowRef.current(), startedAtMs, durationMs);
    if (prefersReducedMotion() || progressNow() >= 1) {
      scene.setPositions(positionsAt(order, 1));
      finish();
      return;
    }
    const stop = scene.onFrame(() => {
      const progress = progressNow();
      scene.setPositions(positionsAt(order, progress));
      if (progress >= 1) {
        stop();
        finish();
      }
    });
    return stop;
  }, [key, scene, failed, durationMs]);

  return (
    <section
      ref={host}
      className="race-track"
      aria-label="Pista de carreras de animales con cinco carriles, del 1 al 5"
    >
      {failed && order ? (
        <ol className="race-track-fallback" aria-label="Orden de llegada">
          {order.map((animal) => (
            <li key={animal}>{animalName(animal)}</li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
