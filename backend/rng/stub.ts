import { NotImplementedError } from "@casino/shared";
import type { SeedPairService } from "./seed-pair-service";

const notImplemented = (method: string) => () =>
  Promise.reject(new NotImplementedError(method, "#11"));

/** Placeholder until #11 implements seed pairs. */
export const stubSeedPairService: SeedPairService = {
  getActive: notImplemented("getActive"),
  draw: notImplemented("draw"),
  setClientSeed: notImplemented("setClientSeed"),
  rotate: notImplemented("rotate"),
};
