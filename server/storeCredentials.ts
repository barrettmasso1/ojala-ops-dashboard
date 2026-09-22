import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

export const STORE_CREDENTIAL_TYPES = ["staff_portal", "frigate"] as const;
export type StoreCredentialType = (typeof STORE_CREDENTIAL_TYPES)[number];

export const STORE_CREDENTIAL_FORMATS = ["scrypt_v1", "sha256_v1"] as const;
export type StoreCredentialFormat = (typeof STORE_CREDENTIAL_FORMATS)[number];

const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024;

function deriveScrypt(password: string, salt: Buffer, N: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, SCRYPT_KEY_LENGTH, { N, r, p, maxmem: SCRYPT_MAX_MEMORY }, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

/**
 * Staff portal passwords may be human-chosen, so they use a salted, costed
 * scrypt verifier. The returned value is safe to persist but never log.
 */
export async function createStaffPasswordVerifier(password: string): Promise<string> {
  if (password.length < 12) throw new Error("Staff portal passwords must be at least 12 characters");
  const salt = randomBytes(16);
  const derivedKey = await deriveScrypt(password, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P);
  return ["scrypt", "v1", SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString("hex"), derivedKey.toString("hex")].join("$");
}

/** Verifies a persisted scrypt verifier without exposing the supplied secret. */
export async function verifyStaffPassword(password: string, verifier: string): Promise<boolean> {
  const [algorithm, version, encodedN, encodedR, encodedP, saltHex, keyHex] = verifier.split("$");
  const N = Number(encodedN);
  const r = Number(encodedR);
  const p = Number(encodedP);
  if (
    algorithm !== "scrypt" ||
    version !== "v1" ||
    !Number.isInteger(N) ||
    !Number.isInteger(r) ||
    !Number.isInteger(p) ||
    N < 2 || r < 1 || p < 1 ||
    !/^[a-f0-9]{32}$/i.test(saltHex ?? "") ||
    !/^[a-f0-9]{128}$/i.test(keyHex ?? "")
  ) {
    return false;
  }

  try {
    const derivedKey = await deriveScrypt(password, Buffer.from(saltHex, "hex"), N, r, p);
    const expectedKey = Buffer.from(keyHex, "hex");
    return derivedKey.length === expectedKey.length && timingSafeEqual(derivedKey, expectedKey);
  } catch {
    return false;
  }
}

/** Generates a 256-bit random API key for a machine-to-machine Frigate sender. */
export function generateFrigateApiKey(): string {
  return randomBytes(32).toString("base64url");
}

/** Random machine keys use a SHA-256 lookup verifier, never plaintext storage. */
export function hashFrigateApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey, "utf8").digest("hex");
}

export function credentialFormatFor(type: StoreCredentialType): StoreCredentialFormat {
  return type === "staff_portal" ? "scrypt_v1" : "sha256_v1";
}

/** Avoid a variable-time string comparison for explicitly enabled legacy env secrets. */
export function legacyCredentialsMatch(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  const providedHash = Buffer.from(hashFrigateApiKey(provided), "utf8");
  const expectedHash = Buffer.from(hashFrigateApiKey(expected), "utf8");
  return providedHash.length === expectedHash.length && timingSafeEqual(providedHash, expectedHash);
}

export function isStoreCredentialType(value: string): value is StoreCredentialType {
  return (STORE_CREDENTIAL_TYPES as readonly string[]).includes(value);
}
