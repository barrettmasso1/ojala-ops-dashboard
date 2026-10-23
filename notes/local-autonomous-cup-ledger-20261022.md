# Local autonomous cup observation registry

Purpose: remove language-model and interactive-browser dependencies from the
core detection registry and its native synchronization, without claiming each
track is a uniquely delivered cup.

Existing v4 model/hash unchanged. Raw Frigate database read-only. The local
collector has a bounded low-CPU service and all new state/evidence on the guarded
external disk. It preserves original images and sidecars, source IDs, capture
intervals and model fingerprints. The first genuine 22 Oct read produced 35
source tracks, 9 same-frame local validations and 8 possible repetitions. This
is not a 35/9/27 unique-cup claim. Repeat collection and restart added no new rows.

Application changes are additive: native authenticated submit/readback routes
and a readonly panel in the existing dashboard. Tenant scope is resolved from
the machine credential or signed-in administrator. Exact source IDs and revision
hashes are enforced. No count rows, approvals, manual sales, inventory, model,
threshold, zone, migration, browser, or external message changes are included.

Storage uses the existing sanctioned backend Forge/S3 helpers but a private
reserved object namespace with conditional ETag writes and fresh readback.
No application/database credentials leave the published application server.
The generic media proxy explicitly blocks that namespace. Unit tests cover
scope isolation and missing-data versus zero semantics. Production conditional
storage compatibility and the native request path require real acceptance;
no successful deployment or delivery is implied merely by this source change.

Local: 80 Python tests passed. App at preparation: 48 files / 441 tests passed;
TypeScript and client/server builds passed. Tests are fixtures, not production
performance/recall results. Native sender remains disabled until a real receipt.
