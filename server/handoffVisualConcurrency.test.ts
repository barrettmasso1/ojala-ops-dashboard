import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseHandoffZoneGeometry } from "./handoffZoneGeometry";

const dbSource = readFileSync("server/db.ts", "utf8");
const routerSource = readFileSync("server/routers.ts", "utf8");
const analysisSource = readFileSync("server/handoffPersistedAnalysis.ts", "utf8");

describe("handoff visual concurrency guards (source-level database contract)", () => {
  it("recovers only an expired analysis lease and issues a fresh token", () => {
    expect(dbSource).toContain("const leaseUntil = new Date(now.getTime() + 5 * 60 * 1_000)");
    expect(dbSource).toContain("const analysisLeaseToken = randomUUID()");
    expect(dbSource).toContain("lte(frigateHandoffVisualEvents.analysisLeaseUntil, now)");
    expect(dbSource).toContain("analysisLeaseToken,");
  });

  it("makes timeout/retry defer conditional on the exact active lease", () => {
    expect(dbSource).toContain("export async function deferHandoffVisualAnalysis");
    expect(dbSource).toContain("eq(frigateHandoffVisualEvents.analysisLeaseToken, input.analysisLeaseToken)");
    expect(analysisSource).toContain("analysisLeaseToken,");
    expect(routerSource).toContain("return analyzePersistedHandoffVisual(event,");
    expect(analysisSource).toContain("getHandoffVisualRetryDelayMs(event.analysisAttempts + 1)");
  });

  it("cannot let a late AI response overwrite a manager decision", () => {
    expect(dbSource).toContain("export async function finalizeHandoffVisualAnalysis");
    expect(dbSource).toContain('eq(frigateHandoffVisualEvents.analysisStatus, "pending_review")');
    expect(dbSource).toContain("analysisLeaseToken: null,");
    expect(dbSource).toContain("export async function reviewHandoffVisualEvent");
    expect(dbSource).toContain("reviewedByUserId: input.reviewedByUserId");
  });

  it("excludes native local evidence from generic reservation, normalization, leases, and finalization", () => {
    expect(dbSource).toContain('import { NATIVE_LOCAL_EVIDENCE_SOURCE_PREFIX, isNativeLocalEvidenceSource } from "./nativeLocalEvidence"');
    expect(dbSource).toContain('native evidence requires the native evidence route');
    expect(dbSource).toContain('LEFT(${frigateHandoffVisualEvents.sourceDetail}, ${NATIVE_LOCAL_EVIDENCE_SOURCE_PREFIX.length}) <> ${NATIVE_LOCAL_EVIDENCE_SOURCE_PREFIX}');
    expect(routerSource).toContain('Native local evidence cannot enter visual analysis');
    expect(analysisSource).toContain('disposition: "native_local_only" as const');
  });
});

describe("handoff zone geometry", () => {
  it("requires an explicit normalized polygon rather than a camera name", () => {
    expect(parseHandoffZoneGeometry([
      { x: 0.1, y: 0.2 },
      { x: 0.8, y: 0.2 },
      { x: 0.8, y: 0.9 },
    ])).toEqual({ points: [{ x: 0.1, y: 0.2 }, { x: 0.8, y: 0.2 }, { x: 0.8, y: 0.9 }] });
    expect(() => parseHandoffZoneGeometry([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toThrow("between 3");
    expect(() => parseHandoffZoneGeometry([{ x: -0.1, y: 0 }, { x: 0.4, y: 0.2 }, { x: 0.8, y: 0.9 }])).toThrow("0 to 1");
  });
});
