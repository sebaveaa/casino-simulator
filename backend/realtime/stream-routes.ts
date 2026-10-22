import { apiPaths, raceEventSchema } from "@casino/shared";
import { getAuth } from "../auth/guard";
import { AppError } from "../platform/errors";
import type { ModuleRoutes } from "../platform/routes";

/** Interval between `: ping` comments that keep proxies from closing an idle stream. */
export const HEARTBEAT_MS = 15_000;
/** Simultaneous race streams one user may hold open. */
export const MAX_STREAMS_PER_USER = 3;
/** A client that lets this many bytes pile up unread is dropped instead of buffered. */
export const MAX_BUFFERED_BYTES = 64 * 1024;

export type StreamOptions = {
  /** Heartbeat interval; tests shorten it. */
  heartbeatMs?: number;
};

/** The SSE stream of race events (README §2.5, §8). One instance keeps its own per-user counters. */
export function createStreamRoutes({
  heartbeatMs = HEARTBEAT_MS,
}: StreamOptions = {}): ModuleRoutes {
  return async (app, { services, requireAuth }) => {
    const openStreams = new Map<string, number>();
    // Each entry ends one live stream (idempotent); `onClose` runs them all.
    const closers = new Set<() => void>();

    // `preClose` runs before the server stops accepting; an open stream would keep it waiting.
    app.addHook("preClose", async () => {
      for (const close of [...closers]) close();
    });

    app.get(apiPaths.raceStream, { preHandler: requireAuth() }, (request, reply) => {
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
        request.log.warn({ err: error }, "race stream could not start");
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
      unsubscribe = services.raceEvents.subscribe((event) => {
        // Defensive, on the raw event (the schema would strip it): only `result` reveals the seed.
        // Dropped events are logged without their body: it may carry the seed of a live round.
        if (typeof event === "object" && event !== null) {
          if (event.type !== "result" && "serverSeed" in event) {
            request.log.warn("race event dropped: a seed outside a result event");
            return;
          }
        }
        const parsed = raceEventSchema.safeParse(event);
        if (!parsed.success) {
          const fields = parsed.error.issues.map((issue) => issue.path.join(".") || "(event)");
          request.log.warn({ fields }, "race event dropped: it does not match the event schema");
          return;
        }
        send(`data: ${JSON.stringify(parsed.data)}\n\n`);
      });
      if (finished) unsubscribe();
      else heartbeat = setInterval(() => send(": ping\n\n"), heartbeatMs);
    });
  };
}

export const streamRoutes: ModuleRoutes = createStreamRoutes();
