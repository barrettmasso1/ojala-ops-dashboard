import { afterEach, describe, expect, it } from "vitest";
import {
  CREDENTIAL_RATE_LIMIT_POLICY,
  clearCredentialFailures,
  getCredentialRetryAfterMs,
  recordCredentialFailure,
  resetCredentialRateLimitsForTest,
} from "./credentialRateLimit";

describe("credential rate limiter", () => {
  afterEach(() => resetCredentialRateLimitsForTest());

  it("blocks a client after five failures without storing any supplied credential", () => {
    const now = 1_000_000;
    for (let attempt = 0; attempt < CREDENTIAL_RATE_LIMIT_POLICY.maxFailures; attempt += 1) {
      recordCredentialFailure("staff_portal", "fixture-client", now + attempt);
    }

    expect(getCredentialRetryAfterMs("staff_portal", "fixture-client", now + 10)).toBeGreaterThan(0);
    expect(getCredentialRetryAfterMs("frigate", "fixture-client", now + 10)).toBe(0);
  });

  it("clears only the successful channel and client bucket", () => {
    for (let attempt = 0; attempt < CREDENTIAL_RATE_LIMIT_POLICY.maxFailures; attempt += 1) {
      recordCredentialFailure("frigate", "fixture-client", 1_000 + attempt);
      recordCredentialFailure("staff_portal", "fixture-client", 1_000 + attempt);
    }
    clearCredentialFailures("frigate", "fixture-client");

    expect(getCredentialRetryAfterMs("frigate", "fixture-client", 1_001)).toBe(0);
    expect(getCredentialRetryAfterMs("staff_portal", "fixture-client", 1_001)).toBeGreaterThan(0);
  });
});
