import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

export async function hashPassword(password: string, salt = randomBytes(16).toString("hex")) {
  const hash = (await scrypt(password, salt, 64)) as Buffer;
  return { salt, hash: hash.toString("hex") };
}

export async function verifyPassword(password: string, salt: string, expectedHex: string) {
  const actual = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export const createSessionToken = () => randomBytes(32).toString("base64url");
