import { type ErrorCode, type ErrorResponse, NotImplementedError } from "@casino/shared";
import type { FastifyInstance } from "fastify";

const defaultStatus: Record<ErrorCode, number> = {
  invalid_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  insufficient_funds: 422,
  not_implemented: 501,
  internal: 500,
};

/**
 * An error the API reports to the client as `{ error: { code, message } }`. The message is
 * sent as is, so it must never carry secrets or user input.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;

  constructor(code: ErrorCode, message: string, statusCode: number = defaultStatus[code]) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function body(code: ErrorCode, message: string): ErrorResponse {
  return { error: { code, message } };
}

/** The 4xx status Fastify attached to an error it raised itself (malformed JSON, too large, ...). */
function clientStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("statusCode" in error)) return undefined;
  const { statusCode } = error;
  return typeof statusCode === "number" && statusCode >= 400 && statusCode < 500
    ? statusCode
    : undefined;
}

/**
 * Makes every error response, including unknown routes, match `errorResponseSchema`.
 * Unexpected errors are logged and answered with a generic message, never their own.
 */
export function registerErrorHandlers(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send(body(error.code, error.message));
    }
    if (error instanceof NotImplementedError) {
      return reply.code(501).send(body("not_implemented", error.message));
    }
    if (clientStatus(error) !== undefined) {
      return reply.code(400).send(body("invalid_request", "Malformed request"));
    }
    request.log.error(error, "unhandled error");
    return reply.code(500).send(body("internal", "Internal server error"));
  });

  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send(body("not_found", "Route not found")),
  );
}
