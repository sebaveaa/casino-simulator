import type { FastifyInstance } from "fastify";
import type { RequireAuth } from "../auth/guard";
import { authRoutes } from "../auth/routes";
import type { Db } from "../db/database";
import { blackjackRoutes } from "../games/blackjack/routes";
import { chickenRoadRoutes } from "../games/chicken-road/routes";
import { crashRoutes } from "../games/crash/routes";
import { racesRoutes } from "../games/races/routes";
import { rouletteRoutes } from "../games/roulette/routes";
import { crashStreamRoutes } from "../realtime/crash-stream-routes";
import { streamRoutes } from "../realtime/stream-routes";
import { seedPairRoutes } from "../rng/routes";
import { walletRoutes } from "../wallet/routes";
import type { Config } from "./config";
import type { Services } from "./services";

/** The settings the race routes read. */
export type RaceSettings = Pick<
  Config,
  "raceDurationMs" | "raceIntermissionMs" | "raceMinStake" | "raceMaxStake"
>;

export type RouteDeps = {
  db: Db;
  services: Services;
  requireAuth: RequireAuth;
  config: RaceSettings;
};
export type ModuleRoutes = (app: FastifyInstance, deps: RouteDeps) => Promise<void>;

// Each module ticket (#9 auth, #10 wallet, #11 seed pairs, #12 roulette, #45 Chicken Road,
// #63 Blackjack) appends its routes function here, using the paths from shared `apiPaths`.
export const moduleRoutes: ModuleRoutes[] = [
  authRoutes,
  walletRoutes,
  seedPairRoutes,
  rouletteRoutes,
  racesRoutes,
  streamRoutes,
  chickenRoadRoutes,
  blackjackRoutes,
  crashRoutes,
  crashStreamRoutes,
];
