import { createHash, timingSafeEqual } from "node:crypto";

export const STORE_CREDENTIAL_TYPES = ["staff_portal", "frigate"] as const;
export type StoreCredentialType = (typeof STORE_CREDENTIAL_TYPES)[number];

/**
 * Hash a credential before persistence. Plain credentials are intentionally
 * accepted only at the request boundary and never returned or stored.
 */
export function hashStoreCredential(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/**
 * Avoid a variable-time string comparison for the two legacy env credentials.
 */
export function credentialsMatch(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  const providedHash = Buffer.from(hashStoreCredential(provided), "utf8");
  const expectedHash = Buffer.from(hashStoreCredential(expected), "utf8");
  return providedHash.length === expectedHash.length && timingSafeEqual(providedHash, expectedHash);
}

export function isStoreCredentialType(value: string): value is StoreCredentialType {
  return (STORE_CREDENTIAL_TYPES as readonly string[]).includes(value);
}
