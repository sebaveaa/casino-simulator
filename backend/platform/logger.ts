import type { FastifyReply, FastifyRequest } from "fastify";
import pino, { type DestinationStream, type Logger } from "pino";
import type { Config } from "./config";

// Fastify adds these serializers only to a logger it creates itself. With a logger instance it
// logs the request and reply objects as given, so the instance carries them.
const serializers = {
  req: (request: FastifyRequest) => ({
    method: request.method,
    url: request.url,
    host: request.host,
    remoteAddress: request.ip,
    remotePort: request.socket?.remotePort,
  }),
  res: (reply: FastifyReply) => ({ statusCode: reply.statusCode }),
  err: pino.stdSerializers.err,
};

/**
 * The API's logger. `main.ts` creates it before the database and Redis clients so their error
 * callbacks have somewhere to log, then hands the same instance to Fastify.
 */
export function createLogger(
  config: Pick<Config, "appEnv">,
  destination?: DestinationStream,
): Logger {
  const options = { level: config.appEnv === "development" ? "debug" : "info", serializers };
  return destination ? pino(options, destination) : pino(options);
}
