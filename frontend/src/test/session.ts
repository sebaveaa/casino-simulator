import type { Session } from "../session";
import { createUnsignedJwt } from "../session/jwt";
import { SESSION_STORAGE_KEY } from "../session/store";

export const TEST_USER = {
  id: "7f1c2a3e-5b6d-4e8f-9a0b-1c2d3e4f5a6b",
  email: "ana@casino.test",
  role: "player",
} as const;

/** A session whose token expires `expiresInSeconds` from now (negative for an expired one). */
export function makeSession(expiresInSeconds = 3600): Session {
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  return {
    token: createUnsignedJwt({ sub: TEST_USER.id, role: TEST_USER.role, exp }),
    user: { ...TEST_USER },
  };
}

/** Writes a session into `localStorage` the way the app does, before the app renders. */
export function seedSession(session: Session = makeSession()): Session {
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  return session;
}
