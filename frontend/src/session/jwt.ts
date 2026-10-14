function base64UrlEncode(text: string): string {
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(text: string): string {
  return atob(text.replace(/-/g, "+").replace(/_/g, "/"));
}

/**
 * Reads the `exp` claim (seconds since the epoch) from a JWT payload. The signature is not
 * checked: the server is the only verifier, and the client only needs to drop tokens it knows
 * are stale. Returns null for anything that is not a decodable token with a numeric `exp`.
 */
export function readJwtExpiry(token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload: unknown = JSON.parse(base64UrlDecode(parts[1] ?? ""));
    if (typeof payload !== "object" || payload === null || !("exp" in payload)) return null;
    return typeof payload.exp === "number" && Number.isFinite(payload.exp) ? payload.exp : null;
  } catch {
    return null;
  }
}

/** Builds an unsigned, JWT-shaped token. Used by the in-memory mock API and by tests only. */
export function createUnsignedJwt(claims: Record<string, string | number>): string {
  const header = base64UrlEncode(JSON.stringify({ alg: "none", typ: "JWT" }));
  return `${header}.${base64UrlEncode(JSON.stringify(claims))}.mock`;
}
