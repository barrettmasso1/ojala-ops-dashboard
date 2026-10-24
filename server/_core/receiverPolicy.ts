const receiverProcedureMethods = {
  "/frigate.submitHandoffVisual": ["POST"],
  "/frigate.submitCounts": ["POST"],
  "/frigate.ingestionCapabilities": ["GET"],
  "/frigate.localEvidenceCapabilities": ["GET"],
  "/frigate.submitLocalCupEvidence": ["POST"],
  "/frigate.localCupEvidenceReceipt": ["POST"],
} as const;

/** Receiver exposure is explicit: only scoped native photo procedures are added. */
export function receiverProcedureAllowed(path: string, method: string) {
  const methods = receiverProcedureMethods[path as keyof typeof receiverProcedureMethods];
  return Boolean(methods?.includes(method as never));
}
