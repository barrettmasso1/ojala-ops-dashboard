const receiverProcedureMethods = {
  "/frigate.submitHandoffVisual": ["POST"],
  "/frigate.submitCounts": ["POST"],
  "/frigate.ingestionCapabilities": ["GET"],
  "/frigate.localEvidenceCapabilities": ["GET"],
  "/frigate.submitLocalCupEvidence": ["POST"],
  "/frigate.finalizeLocalCupEvidence": ["POST"],
  "/frigate.localCupEvidenceReceipt": ["POST"],
  "/frigate.counterPickupCapabilities": ["GET"],
  "/frigate.submitCounterPickups": ["POST"],
  "/frigate.counterPickupReceipt": ["POST"],
} as const;

/** Receiver exposure is explicit: native photo and optical pickup procedures remain narrowly allowlisted. */
export function receiverProcedureAllowed(path: string, method: string) {
  const methods = receiverProcedureMethods[path as keyof typeof receiverProcedureMethods];
  return Boolean(methods?.includes(method as never));
}
