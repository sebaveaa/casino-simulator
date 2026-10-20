export type Loop = {
  /** Schedules no more ticks and resolves once the tick in flight, if any, has finished. */
  stop(): Promise<void>;
};

/**
 * Runs `tick` right away and then `intervalMs` after each tick ends (a recursive `setTimeout`),
 * so ticks never overlap. A failed tick is reported to `onError` and the loop goes on.
 */
export function startLoop(
  tick: () => Promise<void>,
  { intervalMs, onError }: { intervalMs: number; onError: (error: unknown) => void },
): Loop {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> = Promise.resolve();

  const run = (): void => {
    timer = undefined;
    inFlight = (async () => {
      try {
        await tick();
      } catch (error) {
        try {
          onError(error);
        } catch {
          // A broken error reporter must not stop the loop.
        }
      }
      if (!stopped) timer = setTimeout(run, intervalMs);
    })();
  };

  timer = setTimeout(run, 0);
  return {
    async stop() {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      await inFlight;
    },
  };
}
