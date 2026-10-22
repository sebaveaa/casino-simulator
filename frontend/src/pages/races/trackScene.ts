import {
  buildRunners,
  buildTrack,
  laneCenterY,
  readTrackPalette,
  runnerX,
  SCENE_HEIGHT,
  SCENE_WIDTH,
} from "./trackDrawing";

export interface TrackScene {
  /** Places every animal (index = animal id) at its advance in [0, 1]. */
  setPositions(positions: number[]): void;
  /** Runs `frame` on every ticker frame until the returned function is called. */
  onFrame(frame: () => void): () => void;
  destroy(): void;
}

/** Mounts the PixiJS track in `host`. Only this module touches PixiJS (needs WebGL/canvas). */
export async function createTrackScene(host: HTMLElement): Promise<TrackScene> {
  // Loaded on demand: PixiJS stays out of the main bundle.
  const pixi = await import("pixi.js");
  const app = new pixi.Application();
  await app.init({
    width: SCENE_WIDTH,
    height: SCENE_HEIGHT,
    backgroundAlpha: 0,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
  });
  app.canvas.style.width = "100%";
  app.canvas.style.height = "auto";
  host.appendChild(app.canvas);

  const palette = readTrackPalette();
  const runners = buildRunners(pixi, palette);
  app.stage.addChild(buildTrack(pixi, palette), ...runners);

  let destroyed = false;
  return {
    setPositions(positions) {
      runners.forEach((runner, animal) => {
        runner.position.set(runnerX(positions[animal] ?? 0), laneCenterY(animal));
      });
    },
    onFrame(frame) {
      app.ticker.add(frame);
      return () => {
        if (!destroyed) app.ticker.remove(frame);
      };
    },
    destroy() {
      destroyed = true;
      app.destroy(true, { children: true });
    },
  };
}
