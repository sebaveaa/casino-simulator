import { describe, expect, it, vi } from "vitest";
import { ApiError } from "./client";
import { createHttpApiClient } from "./http";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

function setup(response: Response | Error, token: string | null = "tok") {
  const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>) => {
    if (response instanceof Error) throw response;
    return response;
  });
  const client = createHttpApiClient({
    baseUrl: "http://api.test/",
    getToken: () => token,
    fetch: fetchMock as unknown as typeof fetch,
  });
  return { client, fetchMock };
}

describe("HTTP API client", () => {
  it("sends method, path, body, auth and idempotency headers", async () => {
    const { client, fetchMock } = setup(
      json({ transactionId: crypto.randomUUID(), balance: "1500" }),
    );
    const res = await client.deposit({ amount: "500" }, "key-00000001");
    expect(res.balance).toBe("1500");
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("http://api.test/wallet/deposits");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ amount: "500" }));
    const headers = init?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer tok");
    expect(headers["idempotency-key"]).toBe("key-00000001");
    expect(headers["content-type"]).toBe("application/json");
  });

  it("omits Authorization without a token and builds the history query", async () => {
    const { client, fetchMock } = setup(json({ items: [], nextCursor: null }), null);
    await client.listTransactions({ limit: 5, cursor: "abc" });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("http://api.test/wallet/transactions?limit=5&cursor=abc");
    expect(init?.method).toBe("GET");
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
  });

  it("maps an error body to ApiError", async () => {
    const { client } = setup(
      json({ error: { code: "insufficient_funds", message: "Not enough credits" } }, 409),
    );
    const error = await client.getBalance().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: "insufficient_funds", status: 409 });
    expect((error as ApiError).message).toBe("Not enough credits");
  });

  it("falls back to internal for a non-error failure body", async () => {
    const { client } = setup(new Response("oops", { status: 502 }));
    await expect(client.getBalance()).rejects.toMatchObject({ code: "internal", status: 502 });
  });

  it("rejects a success body that violates the schema", async () => {
    const { client } = setup(json({ balance: -5 }));
    await expect(client.getBalance()).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("maps a rejected fetch to a network error", async () => {
    const { client } = setup(new TypeError("failed to fetch"));
    await expect(client.getBalance()).rejects.toMatchObject({ code: "network", status: 0 });
  });
});
