import { describe, expect, it } from "vitest";
import { storeCredentials } from "../drizzle/schema";
import {
  createStaffPasswordVerifier,
  credentialFormatFor,
  generateFrigateApiKey,
  hashFrigateApiKey,
  isStoreCredentialType,
  legacyCredentialsMatch,
  verifyStaffPassword,
} from "./storeCredentials";

describe("store credential boundaries", () => {
  it("uses independent salted scrypt verifiers for a human staff password", async () => {
    const password = "human-fixture-password";
    const first = await createStaffPasswordVerifier(password);
    const second = await createStaffPasswordVerifier(password);

    expect(first).toMatch(/^scrypt\$v1\$16384\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
    expect(second).not.toBe(first);
    await expect(verifyStaffPassword(password, first)).resolves.toBe(true);
    await expect(verifyStaffPassword("incorrect-fixture-password", first)).resolves.toBe(false);
  });

  it("generates 256-bit Frigate machine keys and persists only a lookup hash", () => {
    const apiKey = generateFrigateApiKey();
    const verifier = hashFrigateApiKey(apiKey);

    expect(apiKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(verifier).toHaveLength(64);
    expect(verifier).not.toContain(apiKey);
    expect(storeCredentials.credentialVerifier.name).toBe("credentialVerifier");
    expect(Object.keys(storeCredentials).some(key => /password|apiKey|secret/i.test(key))).toBe(false);
  });

  it("matches a legacy environment credential without accepting a near match", () => {
    expect(legacyCredentialsMatch("legacy-secret", "legacy-secret")).toBe(true);
    expect(legacyCredentialsMatch("legacy-secret", "legacy-secret-")).toBe(false);
    expect(legacyCredentialsMatch("", "legacy-secret")).toBe(false);
  });

  it("pins each server-recognized credential type to its intended verifier format", () => {
    expect(credentialFormatFor("staff_portal")).toBe("scrypt_v1");
    expect(credentialFormatFor("frigate")).toBe("sha256_v1");
    expect(isStoreCredentialType("staff_portal")).toBe(true);
    expect(isStoreCredentialType("frigate")).toBe(true);
    expect(isStoreCredentialType("admin")).toBe(false);
  });
});
