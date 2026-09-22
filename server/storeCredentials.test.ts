import { describe, expect, it } from "vitest";
import { storeCredentials } from "../drizzle/schema";
import { credentialsMatch, hashStoreCredential, isStoreCredentialType } from "./storeCredentials";

describe("store credential boundaries", () => {
  it("persists deterministic hashes rather than plaintext credential fields", () => {
    const secret = "fixture-store-credential";
    const hash = hashStoreCredential(secret);

    expect(hash).toHaveLength(64);
    expect(hash).not.toContain(secret);
    expect(storeCredentials.credentialHash.name).toBe("credentialHash");
    expect(Object.keys(storeCredentials).some(key => /password|apiKey|secret/i.test(key))).toBe(false);
  });

  it("matches a legacy credential without accepting a near match", () => {
    expect(credentialsMatch("legacy-secret", "legacy-secret")).toBe(true);
    expect(credentialsMatch("legacy-secret", "legacy-secret-")).toBe(false);
    expect(credentialsMatch("", "legacy-secret")).toBe(false);
  });

  it("limits credential types to server-recognized integration roles", () => {
    expect(isStoreCredentialType("staff_portal")).toBe(true);
    expect(isStoreCredentialType("frigate")).toBe(true);
    expect(isStoreCredentialType("admin")).toBe(false);
  });
});
