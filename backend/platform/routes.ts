import type { FastifyInstance } from "fastify";
import type { RequireAuth } from "../auth/guard";
import type { Db } from "../db/database";
import { walletRoutes } from "../wallet/routes";
import type { Services } from "./services";

export type RouteDeps = { db: Db; services: Services; requireAuth: RequireAuth };
export type ModuleRoutes = (app: FastifyInstance, deps: RouteDeps) => Promise<void>;

// Each module ticket (#9 auth, #10 wallet, #11 seed pairs, #12 roulette) appends its routes
// function here, using the paths from shared `apiPaths`.
export const moduleRoutes: ModuleRoutes[] = [walletRoutes];
