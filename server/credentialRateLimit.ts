type CredentialChannel = "staff_portal" | "frigate";

type AttemptBucket = {
  failures: number;
  firstFailureAt: number;
  blockedUntil: number;
};

const WINDOW_MS = 15 * 60 * 1_000;
const BLOCK_MS = 15 * 60 * 1_000;
const MAX_FAILURES = 5;
const buckets = new Map<string, AttemptBucket>();

function bucketKey(channel: CredentialChannel, clientKey: string) {
  return `${channel}:${clientKey || "unknown"}`;
}

function cleanup(now: number) {
  for (const [key, bucket] of Array.from(buckets.entries())) {
    if (bucket.blockedUntil <= now && bucket.firstFailureAt + WINDOW_MS <= now) buckets.delete(key);
  }
}

/** Returns retry delay without retaining the submitted password or API key. */
export function getCredentialRetryAfterMs(channel: CredentialChannel, clientKey: string, now = Date.now()): number {
  cleanup(now);
  const bucket = buckets.get(bucketKey(channel, clientKey));
  return bucket && bucket.blockedUntil > now ? bucket.blockedUntil - now : 0;
}

export function recordCredentialFailure(channel: CredentialChannel, clientKey: string, now = Date.now()) {
  cleanup(now);
  const key = bucketKey(channel, clientKey);
  const current = buckets.get(key);
  const bucket = !current || current.firstFailureAt + WINDOW_MS <= now
    ? { failures: 0, firstFailureAt: now, blockedUntil: 0 }
    : current;
  bucket.failures += 1;
  if (bucket.failures >= MAX_FAILURES) bucket.blockedUntil = now + BLOCK_MS;
  buckets.set(key, bucket);
  return bucket;
}

export function clearCredentialFailures(channel: CredentialChannel, clientKey: string) {
  buckets.delete(bucketKey(channel, clientKey));
}

/** Test-only reset; the limiter is in-memory and intentionally never persists secrets. */
export function resetCredentialRateLimitsForTest() {
  buckets.clear();
}

export const CREDENTIAL_RATE_LIMIT_POLICY = {
  maxFailures: MAX_FAILURES,
  windowMs: WINDOW_MS,
  blockMs: BLOCK_MS,
} as const;
