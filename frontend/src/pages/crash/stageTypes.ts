/** What a Crash scene (Dino Crash, Despegue) needs to draw itself. */
export interface CrashStageProps {
  /** `waiting` before takeoff, `flying` in the air, then the outcome. */
  phase: "waiting" | "flying" | "impact" | "cap";
  /** The current multiplier in hundredths, for height/progress of the animation. */
  hundredths: number;
}
