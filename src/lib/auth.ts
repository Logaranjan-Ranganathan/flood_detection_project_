import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";

const KEY_LEN = 64;

/** scrypt `salt:hash` — no native bcrypt build needed on Windows. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEY_LEN);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  if (expected.length !== KEY_LEN) return false;
  const actual = scryptSync(password, salt, KEY_LEN);
  return timingSafeEqual(actual, expected);
}

/** Opaque device / session tokens: plaintext is only ever returned once. */
export function generateToken(prefix = ""): string {
  const body = randomBytes(24).toString("base64url");
  return prefix ? `${prefix}_${body}` : body;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function tokenPrefixOf(token: string): string {
  return token.slice(0, 10);
}

export function safeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
