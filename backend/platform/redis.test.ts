import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { reportRedisErrors } from "./redis";

describe("reportRedisErrors", () => {
  it("reports an error without throwing", () => {
    const client = new EventEmitter();
    const onError = vi.fn();
    reportRedisErrors(client as never, onError);
    const error = new Error("connect ECONNREFUSED");
    expect(() => client.emit("error", error)).not.toThrow();
    expect(onError).toHaveBeenCalledWith(error);
  });

  it("skips repeats of the same message until the connection is ready again", () => {
    const client = new EventEmitter();
    const onError = vi.fn();
    reportRedisErrors(client as never, onError);
    client.emit("error", new Error("connect ECONNREFUSED"));
    client.emit("error", new Error("connect ECONNREFUSED"));
    expect(onError).toHaveBeenCalledTimes(1);
    client.emit("error", new Error("read ETIMEDOUT"));
    expect(onError).toHaveBeenCalledTimes(2);
    client.emit("ready");
    client.emit("error", new Error("read ETIMEDOUT"));
    expect(onError).toHaveBeenCalledTimes(3);
  });
});
