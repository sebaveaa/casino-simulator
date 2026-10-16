import { pocketColor } from "@casino/shared";
import type * as Pixi from "pixi.js";
import { easeOutCubic, POCKET_ANGLE, spinTarget, WHEEL_ORDER } from "./wheelAngles";

export const WHEEL_SIZE = 360;
const SPIN_TURNS = 5;
const SPIN_MS = 4500;

const COLORS = { red: 0xd62839, black: 0x141414, green: 0x1b8a3e } as const;

export interface WheelScene {
  /** Spins to `pocket`; `onEnd` runs when the wheel stops. Replaces a spin in progress. */
  spinTo(pocket: number, onEnd: () => void, instant: boolean): void;
  destroy(): void;
}

function buildWheel(pixi: typeof Pixi, radius: number): Pixi.Container {
  const { Container, Graphics, Text } = pixi;
  const wheel = new Container();
  const rim = new Graphics().circle(0, 0, radius + 6).fill(0x141414);
  wheel.addChild(rim);

  WHEEL_ORDER.forEach((pocket, index) => {
    const centre = index * POCKET_ANGLE;
    // Pixi measures arcs from the +x axis; the wheel measures clockwise from the top.
    const start = centre - POCKET_ANGLE / 2 - Math.PI / 2;
    const end = centre + POCKET_ANGLE / 2 - Math.PI / 2;
    const wedge = new Graphics()
      .moveTo(0, 0)
      .arc(0, 0, radius, start, end)
      .closePath()
      .fill(COLORS[pocketColor(pocket)])
      .stroke({ width: 1, color: 0xffc933 });
    wheel.addChild(wedge);

    const label = new Text({
      text: String(pocket),
      style: { fill: 0xffffff, fontSize: 14, fontWeight: "700", fontFamily: "monospace" },
    });
    label.anchor.set(0.5);
    label.position.set(Math.sin(centre) * radius * 0.85, -Math.cos(centre) * radius * 0.85);
    label.rotation = centre;
    wheel.addChild(label);
  });

  wheel.addChild(
    new Graphics()
      .circle(0, 0, radius * 0.45)
      .fill(0xf1ecff)
      .stroke({ width: 3, color: 0x141414 }),
  );
  return wheel;
}

/** Mounts the PixiJS wheel in `host`. Only this module touches PixiJS (needs WebGL/canvas). */
export async function createWheelScene(host: HTMLElement): Promise<WheelScene> {
  // Loaded on demand: PixiJS stays out of the main bundle and out of the other pages.
  const pixi = await import("pixi.js");
  const { Application, Graphics } = pixi;
  const app = new Application();
  await app.init({
    width: WHEEL_SIZE,
    height: WHEEL_SIZE,
    backgroundAlpha: 0,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
  });
  // Let the layout size the canvas so the wheel shrinks on narrow screens.
  app.canvas.style.width = "100%";
  app.canvas.style.height = "100%";
  host.appendChild(app.canvas);

  const radius = WHEEL_SIZE / 2 - 24;
  const wheel = buildWheel(pixi, radius);
  wheel.position.set(WHEEL_SIZE / 2, WHEEL_SIZE / 2);
  app.stage.addChild(wheel);

  // Pointer at the top, over the rim.
  const pointer = new Graphics()
    .poly([WHEEL_SIZE / 2 - 12, 0, WHEEL_SIZE / 2 + 12, 0, WHEEL_SIZE / 2, 26])
    .fill(0xff5a36)
    .stroke({ width: 3, color: 0x141414 });
  app.stage.addChild(pointer);

  let stopCurrent: (() => void) | null = null;

  return {
    spinTo(pocket, onEnd, instant) {
      stopCurrent?.();
      const from = wheel.rotation;
      const to = spinTarget(from, pocket, instant ? 0 : SPIN_TURNS);
      if (instant) {
        wheel.rotation = to;
        onEnd();
        return;
      }
      let elapsed = 0;
      const tick = () => {
        elapsed += app.ticker.deltaMS;
        wheel.rotation = from + (to - from) * easeOutCubic(elapsed / SPIN_MS);
        if (elapsed >= SPIN_MS) {
          stop();
          onEnd();
        }
      };
      const stop = () => {
        app.ticker.remove(tick);
        stopCurrent = null;
      };
      stopCurrent = stop;
      app.ticker.add(tick);
    },
    destroy() {
      stopCurrent?.();
      app.destroy(true, { children: true });
    },
  };
}
