import { type CrashGameConfig, CrashPage } from "./crash/CrashPage";
import { PlaneStage } from "./crash/PlaneStage";

// "aviator" is only the internal identifier; the interface always calls the game "Despegue".
const aviatorConfig: CrashGameConfig = {
  game: "aviator",
  title: "Despegue",
  stageLabel: "Cielo",
  Stage: PlaneStage,
  impactText: (multiplier) => `¡Se fue volando! ${multiplier}`,
  capText: "¡Llegó al cielo! 20,00x",
};

/** Despegue: the Crash engine with the climbing-plane scene. */
export function AviatorPage() {
  return <CrashPage config={aviatorConfig} />;
}
