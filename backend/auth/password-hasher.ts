import { compare, hash } from "bcryptjs";

/** bcrypt work factor; 10 is the library default and keeps a login near 100 ms in pure JS. */
const COST = 10;

export function hashPassword(password: string): Promise<string> {
  return hash(password, COST);
}

export function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return compare(password, passwordHash);
}

let unknownUserHash: Promise<string> | undefined;

/**
 * Spends the same time as a real check when the account does not exist, so response time does
 * not reveal whether an email is registered (README §8).
 */
export async function verifyAgainstUnknownUser(password: string): Promise<false> {
  unknownUserHash ??= hashPassword("unknown-user-placeholder");
  await verifyPassword(password, await unknownUserHash);
  return false;
}
