import type * as Pixi from "pixi.js";
import {
  type BallPose,
  ballAngle,
  ballOpacity,
  ballPose,
  FADE_MS,
  HOP_END_MS,
  planBall,
  RESTING_POSE,
  reducedBall,
  TOTAL_MS,
  WIN_RING_MS,
  wheelRotation,
  winRingOpacity,
} from "./ballMotion";
import {
  buildBall,
  buildBowl,
  buildWheel,
  buildWinRing,
  CENTER,
  loadWheelFonts,
  readPalette,
  SCENE_SIZE,
} from "./wheelDrawing";

export interface WheelScene {
  /**
   * Spins until the ball rests in `pocket`; `onEnd` runs once, when the wheel stops. With
   * `instant` there is no physics: the ball just appears in the pocket. Replaces a spin in progress.
   */
  spinTo(pocket: number, onEnd: () => void, instant: boolean): void;
  destroy(): void;
}

/** Longest frame the animation counts, so a stalled tab does not skip the whole spin. */
const MAX_FRAME_MS = 100;

/**
 * Mounts the PixiJS ball wheel in `host`. Only this module touches PixiJS (needs WebGL/canvas).
 * The ball is positioned from the target pocket, so it can only ever rest where the server said.
 */
export async function createWheelScene(host: HTMLElement): Promise<WheelScene> {
  // Loaded on demand: PixiJS stays out of the main bundle and out of the other pages.
  const pixi = await import("pixi.js");
  await loadWheelFonts();
  const app = new pixi.Application();
  await app.init({
    width: SCENE_SIZE,
    height: SCENE_SIZE,
    backgroundAlpha: 0,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
  });
  // Let the layout size the canvas so the wheel shrinks on narrow screens.
  app.canvas.style.width = "100%";
  app.canvas.style.height = "100%";
  host.appendChild(app.canvas);

  const palette = readPalette();
  const wheel = buildWheel(pixi, palette);
  wheel.position.set(CENTER, CENTER);
  const { shadow, body } = buildBall(pixi, palette);
  const ball = new pixi.Container();
  ball.addChild(shadow, body);
  ball.visible = false;
  app.stage.addChild(buildBowl(pixi, palette), wheel, ball);

  let ring: Pixi.Container | null = null;
  let stopCurrent: (() => void) | null = null;

  function clearRing() {
    ring?.destroy({ children: true });
    ring = null;
  }

  function placeBall(pocket: number, pose: BallPose) {
    const angle = ballAngle(pocket, pose.offset, wheel.rotation);
    const x = CENTER + Math.sin(angle) * pose.radius;
    const y = CENTER - Math.cos(angle) * pose.radius;
    const scale = 1 + 0.45 * pose.height;
    body.position.set(x, y);
    body.scale.set(scale);
    // Hard offset shadow, like the app's buttons: it grows with the hop but never blurs.
    shadow.position.set(x + 3 + 4 * pose.height, y + 3 + 4 * pose.height);
    shadow.scale.set(scale);
  }

  /** Runs `frame` on every tick with the time since the spin started; stops when it returns true. */
  function animate(frame: (elapsed: number) => boolean) {
    let elapsed = 0;
    const tick = () => {
      elapsed += Math.min(app.ticker.deltaMS, MAX_FRAME_MS);
      if (frame(elapsed)) stop();
    };
    const stop = () => {
      app.ticker.remove(tick);
      stopCurrent = null;
    };
    stopCurrent = stop;
    app.ticker.add(tick);
  }

  return {
    spinTo(pocket, onEnd, instant) {
      stopCurrent?.();
      clearRing();
      ball.visible = true;
      ball.alpha = 0;
      ring = buildWinRing(pixi, palette, pocket);
      wheel.addChild(ring);

      let ended = false;
      const end = () => {
        if (ended) return;
        ended = true;
        onEnd();
      };

      if (instant) {
        // Reduced motion: no physics. The ball fades into the target pocket.
        placeBall(pocket, RESTING_POSE);
        animate((elapsed) => {
          const resting = reducedBall(elapsed);
          ball.alpha = resting.opacity;
          if (elapsed < FADE_MS) return false;
          if (ring) ring.alpha = 0.5;
          end();
          return true;
        });
        return;
      }

      const plan = planBall(Math.random);
      const from = wheel.rotation;
      animate((elapsed) => {
        wheel.rotation = wheelRotation(from, Math.min(elapsed, TOTAL_MS));
        ball.alpha = ballOpacity(elapsed);
        placeBall(pocket, elapsed < HOP_END_MS ? ballPose(elapsed, plan) : RESTING_POSE);
        if (elapsed < TOTAL_MS) return false;
        end();
        const sinceStop = elapsed - TOTAL_MS;
        if (ring && sinceStop < WIN_RING_MS) {
          ring.alpha = winRingOpacity(sinceStop);
          return false;
        }
        clearRing();
        return true;
      });
    },
    destroy() {
      stopCurrent?.();
      app.destroy(true, { children: true });
    },
  };
}
