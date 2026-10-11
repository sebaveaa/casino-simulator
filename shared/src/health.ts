import { z } from "zod";

/**
 * Body of the backend's `GET /health` response. The backend returns it and
 * anyone (frontend, probes, tests) can validate it with this schema.
 */
export const healthResponseSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  checks: z.object({
    postgres: z.boolean(),
    redis: z.boolean(),
  }),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
