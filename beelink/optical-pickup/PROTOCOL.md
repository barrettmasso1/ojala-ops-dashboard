# Counter-to-customer pickup estimates v1

Purpose: repair the actual absence of useful routes. Current directional policy
requires the object to be observed in the staff-origin polygon before handoff.
In the real recorded stream cups become detected only on the counter. A separate
optical tracker can observe a real counter-to-customer exit without fabricating
an unobserved origin. A positive remains a PROVISIONAL PICKUP, not a paid sale,
certified unique vessel, full-day total, or POS substitute. No LLM runtime.

Reference implementation: pickup_core.py (25 fixture tests), video_flow.py.
Policy geometry is explicitly provisional and not commercially validated.
Do NOT relax the older directional protocol or manufacture its detector samples.
Do NOT write frigateCupCounts, sales, manual closes, inventory or reviewer fields.

## Document and transport

protocol: `ojala_counter_pickups_v1`.
Input envelope: sequence positive integer, documentJson exact canonical UTF8 JSON
(max 4MiB), documentSha256 SHA256 of those exact bytes. Store is from machine
credential, never caller storeId. Payload document:

```
{
 "protocol":"ojala_counter_pickups_v1",
 "deviceId":"UUID", "cameraName":"handoff", "businessDate":"YYYY-MM-DD",
 "policyJson":"exact canonical policy", "policySha256":"SHA256",
 "records": [ RECORD ],
 "scope":"recording_optical_pickup_estimates_not_sales",
 "coverage":"candidate_recording_windows_not_continuous_day",
 "requiresPerImageApproval":false, "generativeAiUsed":false,
 "coversWholeBusinessDay":false, "physicalUniqueCountCertified":false
}
```

Record: eventId = sha256(deviceId+'/optical-pickup/'+sourceEventId+'/'+policySha).
Fields: eventId, sourceEventId, observationId, businessDate, imageSha256,
seedCapturedAt, samples, segments, stopReason, source, algorithm.
source = recorded_video_optical_flow; algorithm = sparse_lk_forward_backward_v1.
No client size/count accepted. Derive size from the persisted native observation.
Records are immutable once computed; later invalidation from authoritative native
source or a manager rejection must exclude a previously estimated pickup rather
than delete its evidence. No duplicate IDs, silent truncation or old-row omission.

Sample: at timezone-bearing ISO; box normalized [x,y,w,h]; features integer8..50;
retainedFraction .2..1; forwardBackwardError 0..1; motionResidual 0..3;
frameSha256 hash of decoded grayscale frame at 1152x648. Max121 samples. The
actual MP4 PTS, not invented/interpolated points, supplies each timestamp.

Segments: [{path:'/media/frigate/recordings/YYYY-MM-DD/HH/handoff/MM.SS.mp4',
start:unixSeconds,end:unixSeconds,sha256:64hex}]. Max8; original MP4 content hash
checked by the local worker. Each sample must fall in a listed segment; overlap
at segment edges is permitted. No URL, traversal, external host or secret path.
Store this proof privately, never expose storage signed URLs or paths in public
responses. The seed and all samples must belong to the authenticated tenant day.

Policy fixed thresholds and shape are in validate_policy. Width2304x1296 is the
existing detection coordinate space; recording1280x720 is the confirmed source
video from the same camera and same16:9 frame, NOT a camera configuration change.
Geometry: handoff polygon from native source, customer polygon provisional.
Three hashes bind detector, original handoff geometry, and reference image.

## Eligibility and evaluation

Bind to exact persisted native LocalObservation by device/day/observationId,
sourceEventId, imageSha256, seedCapturedAt, model hash and zone hash. Require
same_frame_local_cv, local original proof and no owner not_cup or source rejection.
Require an existing native photograph with matching source/hash and no manager
rejection; preserve any manager action. Reading the existing evidence is not
permission to change its label. Never call cloud vision or create photos here.

Recompute output using assess/summarize in pickup_core.py. Validate ALL supplied
samples before calculating an outcome, including any samples after a crossing.
Minimum .4s on counter, then two consecutive observations in customer polygon,
with measured displacement >=0.5 seed-box height. No low-quality or long-gap
motion accepted. A track ending or static picture is never a pickup. False or
uncertain identity/flow remains unresolved and must not be coerced to a count.
Cross-event exits within2s and .025normalized distance are identity_uncertain;
not summed and not silently declared the same physical cup. Size unknown remains
unknown; no POS/manual totals used as labels or calibration.

## Same-app API

frigate.counterPickupCapabilities GET unauthenticated no key:
protocol above, receiptProtocol ojala_counter_pickups_receipt_v1,
credentialScoped:true, browserRequired:false, externalAiRequired:false,
requiresPersistedLocalObservation:true,persistedReadbackRequired:true,
createsSales:false,createsReviewedPhysicalCounts:false.

frigate.submitCounterPickups POST {apiKey,...envelope} -> {success:true,receipt}.
frigate.counterPickupReceipt POST {apiKey,deviceId,businessDate} -> {receipt|null}.
Use the SAME backend/storage and tenant, a private object namespace such as
counter-pickups/v1/store-N/device/date.json. Reuse the reviewed origin/ETag identity
storage CAS adapter, preserve PR53 hardening and storage-proxy privacy. Never
weaken guards or use stale CDN readback to acknowledge a write. Conditional first
create and subsequent compare-revision writes; receipt only after persistent read.
409 after dispatch is uncertain: exact receipt must be read, never blind reupload.

Receipt: protocol,persisted:true,storeId,deviceId,businessDate,cameraName,
sequence,documentSha256,receivedAt,recordsPersisted,
partial:true,countsAreSales:false,physicalUniqueCountCertified:false,
externalAiInvoked:false,requiredHumanAction:false.
No claimed physical count or financial mutation implied by receipt.

Dashboard.counterPickups admin GET {businessDate,deviceId}: return authoritative
recomputed total, categories, incomplete/unresolved diagnostics, source intervals,
receipt timestamp and sequence. Empty/unavailable source is NOT zero business
sales. Header counts are provisional pickups; historical manual count remains
separate. Unvalidated capacity categories remain unknown.

## UI

Use the existing DailyOperationsPanel slot the user called Cierre y conteo fisico.
Show live provisional pickups and size breakdown WITHOUT waiting for a close or
requiring photo approval. Refresh5s; same-day cache isolation/reconnect/no-store.
Do not add these estimates to directional legacy figures. Put legacy directional
view in diagnostic details rather than implying the two counters are additive.
Expose candidate-window coverage and unresolved tracking, never claim whole-day
coverage. No global percentage against manual/POS without equal observed periods.

## Acceptance

Strict schema/tenant/source/time/hash/path tests; duplicate and idempotent update
and receipt tests; gap/false-positive/manual-rejection/reverse/static fixtures;
unknown-size/partial UI. No test data in production. No migrations or credentials
changes. Software tests do not certify commercial recall. Verify one genuine
recorded trajectory end-to-end before enabling sender. Local worker remains
thermally guarded, external-first, independently restartable, no browser/LLM.
