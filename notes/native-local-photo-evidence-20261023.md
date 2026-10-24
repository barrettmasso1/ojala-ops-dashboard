# Native original-photo receipt path, not cloud analysis

The native detection ledger was persisted but its image bytes were intentionally
not uploaded. This separate authenticated API accepts an original photograph only
when the same store/device/day/observation already exists in the private ledger
with same-frame local evidence. Original image hash, raw sidecar checksum,
capture timestamp and audited zone normalization must match that ledger proof.
Owner-excluded noncups and source-rejected observations are not newly uploaded.

Uses existing visual-event reservation/storage, preserving original identities,
human decisions and image hashes. Native sourceDetail is NOT the deferred AI
worker's opt-in envelope. processHandoffVisualEvent is called with deferAnalysis
and no background cloud-analysis request. A native receipt is built only from a
fresh stored row with imageKey. Receipt status is not delivery or sales approval.

The standalone external-disk photo queue reads acknowledged local observations.
It reconciles before each initial upload and after uncertain dispatch. 401/403
create a persistent authorization hold. Null receipts require a grace period and
two observations of absence before a bounded retry. Exact-identity acknowledgments
prevent duplicate writes and survive restarts. Legacy holds are never removed.
No camera, model, threshold, schedule, migration, sale or physical count changes.

Focused validation: 28 Python photo-queue tests and 129 server tests PASS
(includes 26 new proof/receipt tests and 9 new route tests). Full suite/TypeScript/
build must pass in the development environment before deployment. No live photo
has been uploaded by this source preparation. New service remains uninstalled.
