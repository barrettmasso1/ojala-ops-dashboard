export type HandoffZonePoint = { x: number; y: number };

export type HandoffZoneGeometry = {
  points: HandoffZonePoint[];
};

const MAX_ZONE_POINTS = 16;

function finiteNormalizedCoordinate(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

/**
 * The zone uses normalized image coordinates (0..1), so its configuration is
 * explicit, portable, and independent of the camera's pixel resolution.
 */
export function parseHandoffZoneGeometry(value: unknown): HandoffZoneGeometry {
  if (!Array.isArray(value) || value.length < 3 || value.length > MAX_ZONE_POINTS) {
    throw new Error(`Handoff zone must contain between 3 and ${MAX_ZONE_POINTS} normalized points`);
  }

  const points = value.map((point) => {
    if (!point || typeof point !== "object") {
      throw new Error("Every handoff zone point must be an object");
    }
    const candidate = point as { x?: unknown; y?: unknown };
    if (!finiteNormalizedCoordinate(candidate.x) || !finiteNormalizedCoordinate(candidate.y)) {
      throw new Error("Handoff zone point coordinates must be numbers from 0 to 1");
    }
    const x = candidate.x as number;
    const y = candidate.y as number;
    return {
      x: Number(x.toFixed(6)),
      y: Number(y.toFixed(6)),
    };
  });

  if (new Set(points.map((point) => `${point.x}:${point.y}`)).size !== points.length) {
    throw new Error("Handoff zone points must be distinct");
  }

  return { points };
}

export function serializeHandoffZoneGeometry(geometry: HandoffZoneGeometry) {
  return JSON.stringify(geometry.points);
}

export function parseStoredHandoffZoneGeometry(serialized: string): HandoffZoneGeometry {
  try {
    return parseHandoffZoneGeometry(JSON.parse(serialized));
  } catch (error) {
    throw new Error(`Stored handoff zone geometry is invalid: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}
