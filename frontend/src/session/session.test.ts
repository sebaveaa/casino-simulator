import { describe, expect, it, vi } from "vitest";
import { makeSession } from "../test/session";
import { createUnsignedJwt, readJwtExpiry } from "./jwt";
import { createSessionStore, SESSION_STORAGE_KEY } from "./store";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    data,
  };
}

describe("readJwtExpiry", () => {
  it("reads exp from the payload", () => {
    expect(readJwtExpiry(createUnsignedJwt({ sub: "u", exp: 1234 }))).toBe(1234);
  });

  it("treats anything undecodable as invalid", () => {
    for (const bad of ["", "abc", "a.b", "a.b.c", "a.!!!.c", `a.${btoa("[1]")}.c`]) {
      expect(readJwtExpiry(bad), bad).toBeNull();
    }
    expect(readJwtExpiry(createUnsignedJwt({ sub: "u" }))).toBeNull();
    expect(readJwtExpiry(createUnsignedJwt({ exp: "soon" }))).toBeNull();
  });
});

describe("session store", () => {
  it("restores a valid stored session", () => {
    const session = makeSession();
    const storage = memoryStorage({ [SESSION_STORAGE_KEY]: JSON.stringify(session) });
    expect(createSessionStore({ storage: () => storage }).get()).toEqual(session);
  });

  it("discards an expired stored token and removes it from storage", () => {
    const storage = memoryStorage({ [SESSION_STORAGE_KEY]: JSON.stringify(makeSession(-60)) });
    expect(createSessionStore({ storage: () => storage }).get()).toBeNull();
    expect(storage.data.has(SESSION_STORAGE_KEY)).toBe(false);
  });

  it("discards corrupt JSON, a wrong shape and an undecodable token", () => {
    const wrong = [
      "{not json",
      JSON.stringify({ token: "x" }),
      JSON.stringify({ ...makeSession(), token: "not-a-jwt" }),
    ];
    for (const raw of wrong) {
      const storage = memoryStorage({ [SESSION_STORAGE_KEY]: raw });
      expect(createSessionStore({ storage: () => storage }).get(), raw).toBeNull();
      expect(storage.data.has(SESSION_STORAGE_KEY)).toBe(false);
    }
  });

  it("persists on set, clears on clear and notifies subscribers", () => {
    const storage = memoryStorage();
    const store = createSessionStore({ storage: () => storage });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    const session = makeSession();

    store.set(session);
    expect(store.get()).toEqual(session);
    expect(JSON.parse(storage.data.get(SESSION_STORAGE_KEY) ?? "null")).toEqual(session);

    store.clear();
    expect(store.get()).toBeNull();
    expect(storage.data.has(SESSION_STORAGE_KEY)).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);

    store.clear();
    unsubscribe();
    store.set(session);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("keeps working in memory when storage throws", () => {
    const storage = () => {
      throw new Error("blocked");
    };
    const store = createSessionStore({ storage });
    expect(store.get()).toBeNull();
    const session = makeSession();
    store.set(session);
    expect(store.get()).toEqual(session);
    store.clear();
    expect(store.get()).toBeNull();
  });

  it("keeps working in memory when storage methods throw", () => {
    const boom = () => {
      throw new Error("quota");
    };
    const store = createSessionStore({
      storage: () => ({ getItem: boom, setItem: boom, removeItem: boom }),
    });
    const session = makeSession();
    store.set(session);
    expect(store.get()).toEqual(session);
  });

  it("keeps working when storage is unavailable", () => {
    const store = createSessionStore({ storage: () => null });
    const session = makeSession();
    store.set(session);
    expect(store.get()).toEqual(session);
  });
});
