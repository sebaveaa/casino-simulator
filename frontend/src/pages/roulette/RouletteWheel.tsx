import { useCallback, useEffect, useRef } from "react";
import { createWheelScene, type WheelScene } from "./wheelScene";

export interface RouletteWheelProps {
  /** Pocket the server already drew; the wheel only animates to it. */
  target: number | null;
  /** Changes on every new result, so the same number twice in a row still spins. */
  spinId: number;
  onSpinEnd: () => void;
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}

/** European roulette wheel drawn with PixiJS. It never decides a result. */
export function RouletteWheel({ target, spinId, onSpinEnd }: RouletteWheelProps) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<WheelScene | null>(null);
  const failed = useRef(false);
  const pending = useRef<{ target: number; spinId: number } | null>(null);
  const handledSpin = useRef(0);
  const onEnd = useRef(onSpinEnd);
  onEnd.current = onSpinEnd;

  const run = useCallback((pocket: number, id: number) => {
    handledSpin.current = id;
    if (failed.current) {
      onEnd.current();
      return;
    }
    if (!scene.current) {
      pending.current = { target: pocket, spinId: id };
      return;
    }
    scene.current.spinTo(pocket, () => onEnd.current(), prefersReducedMotion());
  }, []);

  // Mount once. Cleanup also covers StrictMode's mount, unmount, mount sequence.
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let cancelled = false;
    failed.current = false;
    createWheelScene(element).then(
      (created) => {
        if (cancelled) {
          created.destroy();
          return;
        }
        scene.current = created;
        const waiting = pending.current;
        pending.current = null;
        if (waiting) run(waiting.target, waiting.spinId);
      },
      () => {
        // No WebGL: the result still shows, just without the animation.
        if (cancelled) return;
        failed.current = true;
        const waiting = pending.current;
        pending.current = null;
        if (waiting) run(waiting.target, waiting.spinId);
      },
    );
    return () => {
      cancelled = true;
      pending.current = null;
      scene.current?.destroy();
      scene.current = null;
    };
  }, [run]);

  useEffect(() => {
    if (target === null || spinId === handledSpin.current) return;
    run(target, spinId);
  }, [target, spinId, run]);

  return (
    <div
      ref={host}
      className="roulette-wheel"
      role="img"
      aria-label="Rueda de la ruleta europea, con casillas del 0 al 36"
    />
  );
}
