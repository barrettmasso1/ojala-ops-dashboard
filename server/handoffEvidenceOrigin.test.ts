import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { applyEvidenceOriginPolicy, handoffEvidenceOriginLabel } from "./handoffEvidenceOrigin";

const automaticApproval = {
  personPresent: true,
  gelatoCupPresent: true,
  cupInHandoffZone: true,
  visibleCupCount: 1,
  confidence: "high" as const,
  status: "approved_by_ai" as const,
  reason: "Person, gelato cup, and handoff zone were all confirmed in the same image.",
};

describe("handoff visual evidence origins", () => {
  it("keeps automatic verified snapshots eligible for their normal AI evidence label", () => {
    expect(applyEvidenceOriginPolicy({ origin: "verified_snapshot", analysis: automaticApproval }))
      .toEqual({ analysis: automaticApproval, aiSuggestedStatus: "approved_by_ai" });
  });

  it("requires manager review for a post-hoc recording-extracted frame even when AI sees the required visual conditions", () => {
    const result = applyEvidenceOriginPolicy({ origin: "recording_extracted_frame", analysis: automaticApproval });
    expect(result).toMatchObject({
      aiSuggestedStatus: "approved_by_ai",
      analysis: {
        status: "pending_review",
        visibleCupCount: 1,
        reason: expect.stringContaining("not an automatic Frigate event"),
      },
    });
  });

  it("labels post-hoc evidence explicitly instead of calling it an automatic success", () => {
    expect(handoffEvidenceOriginLabel("recording_extracted_frame")).toContain("manual review");
    expect(handoffEvidenceOriginLabel("verified_snapshot")).toBe("Automatic verified snapshot");
  });

  it("keeps provenance immutable across deduplication, storage, and finalization", () => {
    const dbSource = readFileSync("server/db.ts", "utf8");
    const routerSource = readFileSync("server/routers.ts", "utf8");
    expect(dbSource).toContain('existing[0].evidenceOrigin !== (input.evidenceOrigin ?? "verified_snapshot")');
    expect(dbSource).toContain('concurrent[0].evidenceOrigin !== (input.evidenceOrigin ?? "verified_snapshot")');
    expect(routerSource).toContain("event.evidenceOrigin !== input.evidenceOrigin");
    expect(routerSource).toContain('applyEvidenceOriginPolicy({ origin: event.evidenceOrigin, analysis })');
    expect(routerSource).toContain('"frigate-handoff-recovery"');
  });
});
