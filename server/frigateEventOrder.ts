export type FrigateEventEnvelope = {
  sourceEventId: string;
  sourceEventAt: Date;
};

export type StoredFrigateEvent = FrigateEventEnvelope | null | undefined;

export type FrigateEventDisposition = "apply" | "replay" | "stale";

/**
 * Frigate counts are absolute snapshots, not deltas. Source time determines
 * ordering; counts are deliberately never compared by MAX because a real
 * correction can lower the count. Exact event IDs are safe retries.
 */
export function compareFrigateEventOrder(
  stored: StoredFrigateEvent,
  incoming: FrigateEventEnvelope,
): FrigateEventDisposition {
  if (!stored) return "apply";
  if (stored.sourceEventId === incoming.sourceEventId) return "replay";
  return incoming.sourceEventAt.getTime() > stored.sourceEventAt.getTime() ? "apply" : "stale";
}

export function normalizeFrigateEventAt(value: string): Date | null {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && value.endsWith("Z") ? parsed : null;
}
