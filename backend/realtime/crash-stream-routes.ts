import { apiPaths, crashEventSchema, crashGameSchema } from "@casino/shared";
import { z } from "zod";
import { getAuth } from "../auth/guard";
import { AppError } from "../platform/errors";
import { parseWith } from "../platform/http";
import { createRedisClient } from "../platform/redis";
import type { ModuleRoutes } from "../platform/routes";
import type { CrashEventBus } from "./crash-events";
import { createRedisCrashEventBus, type RedisCrashEventBus } from "./redis-crash-events";

/** Interval between `: ping` comments that keep proxies from closing an idle stream. */
export const HEARTBEAT_MS = 15_000;
/** Simultaneous crash streams one user may hold open. */
export const MAX_STREAMS_PER_USER = 3;
/** A client that lets this many bytes pile up unread is dropped instead of buffered. */
export const MAX_BUFFERED_BYTES = 64 * 1024;

const paramsSchema = z.object({ game: crashGameSchema });

export type CrashStreamOptions = {
  /**
   * The event bus. Tests pass a memory bus. In production it is omitted: the route builds its own
   * Redis-backed bus lazily from `REDIS_URL`, because `backend/platform/{services,app}.ts` and
   * `backend/main.ts` are out of scope for this work and cannot inject one the way races are wired.
   * The API and the worker are separate processes and only share Redis, so a self-built bus is
   * equivalent (PLAN-CRASH §5; see the task file).
   */
  bus?: CrashEventBus;
  /** Heartbeat interval; tests shorten it. */
  heartbeatMs?: number;
};

/** The SSE stream of crash events, per game (README §2.5, §8). Clone of the race stream route. */
export function createCrashStreamRoutes({
  bus,
  heartbeatMs = HEARTBEAT_MS,
}: CrashStreamOptions = {}): ModuleRoutes {
  return async (app, { requireAuth }) => {
    const openStreams = new Map<string, number>();
    // Each entry ends one live stream (idempotent); `onClose` runs them all.
    const closers = new Set<() => void>();

    // Built on the first stream, so a unit test that never opens one touches no Redis.
    let provided = bus;
    let owned: RedisCrashEventBus | undefined;
    const eventBus = (): CrashEventBus => {
      if (provided) return provided;
      const url = process.env.REDIS_URL;
      if (!url) throw new AppError("internal", "Realtime is not configured", 503);
      const redis = createRedisClient({ redisUrl: url }, (error) =>
        app.log.error({ err: error }, "crash event bus redis error"),
      );
      const built = createRedisCrashEventBus(redis, {
        onError: (error) => app.log.warn({ err: error }, "crash event bus"),
      });
      const closeBus = built.close.bind(built);
      // Closing the bus disconnects its subscriber; also drop the publisher connection.
      built.close = async () => {
        await closeBus();
        redis.disconnect();
      };
      owned = built;
      provided = built;
      return built;
    };

    // `preClose` runs before the server stops accepting; an open stream would keep it waiting.
    app.addHook("preClose", async () => {
      for (const close of [...closers]) close();
      if (owned) await owned.close();
    });

    app.get(apiPaths.crashStream, { preHandler: requireAuth() }, (request, reply) => {
      // Validate the game before hijacking the socket, so a bad game is a normal 400.
      const { game } = parseWith(paramsSchema, request.params);
      const userId = getAuth(request).id;
      const count = openStreams.get(userId) ?? 0;
      if (count >= MAX_STREAMS_PER_USER) {
        throw new AppError("invalid_request", "Too many open streams", 429);
      }
      // Take over the socket; keep the headers Fastify and CORS already set on the reply.
      reply.hijack();
      const raw = reply.raw;
      const inherited = Object.fromEntries(
        Object.entries(reply.getHeaders()).filter(([, value]) => value !== undefined),
      ) as Record<string, string | number | string[]>;
      try {
        raw.writeHead(200, {
          ...inherited,
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
          "x-accel-buffering": "no",
        });
      } catch (error) {
        // The slot is counted only once the stream is established, so a failure here leaks none.
        request.log.warn({ err: error }, "crash stream could not start");
        raw.destroy();
        return;
      }
      openStreams.set(userId, count + 1);

      let finished = false;
      let unsubscribe: (() => void) | undefined;
      let heartbeat: NodeJS.Timeout | undefined;

      const finish = () => {
        if (finished) return;
        finished = true;
        clearInterval(heartbeat);
        unsubscribe?.();
        closers.delete(finish);
        const remaining = (openStreams.get(userId) ?? 1) - 1;
        if (remaining > 0) openStreams.set(userId, remaining);
        else openStreams.delete(userId);
        if (!raw.writableEnded) raw.end();
      };

      const send = (chunk: string) => {
        if (finished) return;
        try {
          raw.write(chunk);
        } catch {
          finish();
          return;
        }
        if (raw.writableLength > MAX_BUFFERED_BYTES) {
          // Too slow to follow: cut it off; the client reconnects and re-reads the current round.
          raw.destroy();
          finish();
        }
      };

      closers.add(finish);
      raw.on("close", finish);
      raw.on("error", finish);

      send(": connected\n\n");
      unsubscribe = eventBus().subscribe(game, (event) => {
        // Defensive, on the raw event (the schema would strip it): only `impact` reveals the seed.
        if (typeof event === "object" && event !== null) {
          if (event.type !== "impact" && "serverSeed" in event) {
            request.log.warn("crash event dropped: a seed outside an impact event");
            return;
          }
        }
        const parsed = crashEventSchema.safeParse(event);
        if (!parsed.success) {
          const fields = parsed.error.issues.map((issue) => issue.path.join(".") || "(event)");
          request.log.warn({ fields }, "crash event dropped: it does not match the event schema");
          return;
        }
        send(`data: ${JSON.stringify(parsed.data)}\n\n`);
      });
      if (finished) unsubscribe();
      else heartbeat = setInterval(() => send(": ping\n\n"), heartbeatMs);
    });
  };
}

export const crashStreamRoutes: ModuleRoutes = createCrashStreamRoutes();
