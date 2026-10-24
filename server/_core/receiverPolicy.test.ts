import { describe, expect, it } from "vitest";
import { receiverProcedureAllowed } from "./receiverPolicy";

describe("receiver procedure exposure", () => {
  it("exposes only the three native-photo procedures with their required methods", () => {
    expect(receiverProcedureAllowed("/frigate.localEvidenceCapabilities", "GET")).toBe(true);
    expect(receiverProcedureAllowed("/frigate.submitLocalCupEvidence", "POST")).toBe(true);
    expect(receiverProcedureAllowed("/frigate.localCupEvidenceReceipt", "POST")).toBe(true);
  });

  it("rejects wrong methods and non-allowlisted native-like paths", () => {
    expect(receiverProcedureAllowed("/frigate.localEvidenceCapabilities", "POST")).toBe(false);
    expect(receiverProcedureAllowed("/frigate.submitLocalCupEvidence", "GET")).toBe(false);
    expect(receiverProcedureAllowed("/frigate.localCupEvidenceReceipt", "GET")).toBe(false);
    expect(receiverProcedureAllowed("/frigate.submitLocalCupEvidenceLegacy", "POST")).toBe(false);
    expect(receiverProcedureAllowed("/frigate.submitHandoffVisual", "GET")).toBe(false);
  });
});
