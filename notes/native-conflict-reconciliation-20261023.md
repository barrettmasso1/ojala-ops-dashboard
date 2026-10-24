# Reconcile an uncertain 409 without replaying photographs or counts

Real diagnosis: CloudFront Brotli produced a weak ETag unusable by S3 If-Match.
The published server fix requests identity and requires a strong ETag. Its first
real update then persisted successfully while the immediate readback could still
return the prior revision, so the endpoint correctly withheld a positive receipt
and returned 409. A subsequent independent receipt returned the exact new hash.

The sender now treats 409 after a recorded dispatch as delivery_unknown and reads
an authenticated receipt instead of blindly resending or permanently blocking.
A lower, valid same-store/device/day receipt is awaited for a bounded grace period;
it is never acknowledged or treated as absence. Higher revisions, same-revision
hash conflicts, wrong tenants, malformed receipts, authorization failures and
expired stale-read grace remain explicit blocks. No weak ETag is stripped or faked.

Validation: 105 local unit/integration tests, including three consecutive simulated
updates with delayed receipts and restart recovery. Real Store 1 / 2026-10-23
sequence 4 was read independently with 19 observations and reconciled locally
WITHOUT resending; this is not 19 unique deliveries. No model, camera, thresholds,
sales, manual counts, sizes, credentials or legacy holds changed. No browser opened.
