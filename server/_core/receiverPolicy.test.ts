import { describe, expect, it } from "vitest";
import { receiverProcedureAllowed } from "./receiverPolicy";

describe("receiver procedure exposure", () => {
  it("exposes only the native-photo and counter-pickup procedures with their required methods", () => {
    expect(receiverProcedureAllowed("/frigate.localEvidenceCapabilities", "GET")).toBe(true);
    expect(receiverProcedureAllowed("/frigate.submitLocalCupEvidence", "POST")).toBe(true);
    expect(receiverProcedureAllowed("/frigate.finalizeLocalCupEvidence", "POST")).toBe(true);
    expect(receiverProcedureAllowed("/frigate.localCupEvidenceReceipt", "POST")).toBe(true);
    expect(receiverProcedureAllowed("/frigate.counterPickupCapabilities", "GET")).toBe(true);
    expect(receiverProcedureAllowed("/frigate.submitCounterPickups", "POST")).toBe(true);
    expect(receiverProcedureAllowed("/frigate.counterPickupReceipt", "POST")).toBe(true);
  });

  it("rejects wrong methods and non-allowlisted native-like paths", () => {
    expect(receiverProcedureAllowed("/frigate.localEvidenceCapabilities", "POST")).toBe(false);
    expect(receiverProcedureAllowed("/frigate.submitLocalCupEvidence", "GET")).toBe(false);
    expect(receiverProcedureAllowed("/frigate.localCupEvidenceReceipt", "GET")).toBe(false);
    expect(receiverProcedureAllowed("/frigate.finalizeLocalCupEvidence", "GET")).toBe(false);
    expect(receiverProcedureAllowed("/frigate.finalizeLocalCupEvidenceLegacy", "POST")).toBe(false);
    expect(receiverProcedureAllowed("/frigate.submitLocalCupEvidenceLegacy", "POST")).toBe(false);
    expect(receiverProcedureAllowed("/frigate.submitHandoffVisual", "GET")).toBe(false);
    expect(receiverProcedureAllowed("/frigate.counterPickupCapabilities", "POST")).toBe(false);
    expect(receiverProcedureAllowed("/frigate.submitCounterPickups", "GET")).toBe(false);
    expect(receiverProcedureAllowed("/frigate.counterPickupReceipt", "GET")).toBe(false);
    expect(receiverProcedureAllowed("/frigate.submitCounterPickup", "POST")).toBe(false);
  });
});
