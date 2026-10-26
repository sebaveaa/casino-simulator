import { type CrashGameConfig, CrashPage } from "./crash/CrashPage";
import { DinoStage } from "./crash/DinoStage";

const dinoConfig: CrashGameConfig = {
  game: "dino-crash",
  title: "Dino Crash",
  stageLabel: "Pista",
  Stage: DinoStage,
  impactText: (multiplier) => `¡Impacto! ${multiplier}`,
  capText: "¡Se salvó! 20,00x",
};

/** Dino Crash: the Crash engine with the running-dino scene. */
export function DinoCrashPage() {
  return <CrashPage config={dinoConfig} />;
}
