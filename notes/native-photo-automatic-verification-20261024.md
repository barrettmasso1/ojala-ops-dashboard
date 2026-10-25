# Automatic local validation without per-photo approval

Native image ingestion and local model proof previously ended in a pending human
review status. This worker adds metadata-only automatic finalization of already
persisted native images, inside the existing photo sender. No browser or language
model is required, and the main detector is unchanged.

- Existing upload attempts, image bytes, original hashes and upload receipts remain
  unchanged. A separate local table records validation results and retries.
- The server must advertise ojala_local_automatic_validation_v1 and
  humanApprovalRequired:false with tenant credential scope before any finalize.
- Finalize requires an exact native image/observation proof on the server. Merely
  setting an enum is insufficient. A fresh receipt is read after finalization.
- Manager-approved or manager-discarded images are preserved without mutation.
- Owner noncup exclusions and detector-rejected evidence never receive approval.
- Lost responses are reconciled first; repeated attempts require two settled
  negative readbacks and are bounded. Authentication failures preserve the hold.
- Aggregate health distinguishes automatic-validation failure from photo delivery.
- No photo is promoted to a unique physical delivery, sale, POS item or inventory.

This is a client implementation. It is enabled only after the server contract is
published and independently verified. Development tests: 183 collector/sender
regressions and 56 agent-health regressions PASS. These are software tests, not a
new measurement of cup-detector accuracy. The current 21 human decisions from
October 23 must remain intact; October 24 pending evidence is the bounded initial
backfill scope.
