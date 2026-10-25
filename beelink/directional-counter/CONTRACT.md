# Directional handoff estimates v1 - exact local/server contract

This is NOT a reviewed daily count or a sale. No changes to frigateCupCounts,
POS, closing forms, camera, trained model, credentials or historical business rows.
Live observation begins when a read-only per-frame subscriber is started. Earlier
frames were not retained; do NOT reconstruct earlier deliveries from snapshots.

## Inputs and transport

Existing machine credential resolves store; no browser or generative AI runtime.
Capabilities GET `frigate.directionalHandoffCapabilities` returns:
`protocol: ojala_directional_handoffs_v1`, `receiptProtocol: ojala_directional_handoffs_receipt_v1`,
`credentialScoped: true`, `browserRequired: false`, `externalAiRequired: false`,
`requiresPersistedLocalObservation: true`, `persistedReadbackRequired: true`,
`createsSales: false`, `createsReviewedPhysicalCounts: false`.

Submit POST `frigate.submitDirectionalHandoffs` input {apiKey,sequence,documentJson,documentSha256}.
`documentSha256` is SHA256 of EXACT documentJson bytes, not a reserialization.
Receipt-only POST `frigate.directionalHandoffReceipt` {apiKey,deviceId,businessDate}.
Admin query `dashboard.directionalHandoffs` {deviceId,businessDate}.

Document is the exact output of `Counter.document(day)` in directional_core.py.
The local counter's policy is a string `policyJson` with SHA256 `policySha256`.
Policies bind store/device/camera/zone/model/resolution/timezone; all geometry is
explicitly `provisional_visual_orientation`, commercialAccuracyValidated=false.
Three polygons origin/handoff/destination, two consecutive observed samples per
region, max sample gap1.5s, minimum detector score0.45. Expected runtime dimensions
2304x1296 for this pilot; do not silently rescale if they change.

Each `record.samples` list has 6..160 entries of {metadataJson,metadataSha256}.
Parse metadataJson with the exact schema in sample(): per-frame normalized box,
timezone-bearing at, deviceId, cameraName, sourceEventId, score>=0.45,
falsePositive=false. These are hashes of METADATA, NOT hashes of image bytes.
Validate every hash; same track/scope for every sample; strictly increasing times,
each gap <=1.5s, route <=30s; polygons select exactly one membership by bottom center.
Required route: exactly2 origin samples, >=2 handoff samples, exactly2 destination
samples, no missing/mixed/interpolated samples. A track end never counts.
`completedAt` equals final sample at; eventId is SHA256 of
`deviceId + '/handoff/' + sourceEventId + '/' + policySha256`.

Record status enum:
- awaiting_local_evidence
- estimated
- source_rejected
- owner_excluded
- evidence_conflict
- evidence_not_at_crossing
- identity_ambiguous

Only `estimated` contributes to provisional totals. It requires `localEvidence`
with observationId, imageSha256, capturedAt, size, sizeBasis matching the CURRENT
persisted native local ledger observation from SAME store/device/day. The native
observation must be same_frame_local_cv, not falsePositive, not owner not_cup,
model and source-zone hashes match policy. Local proof personDetections>=1 and
cupScore>=.45 already enforced by the native ledger. Image time must lie between
first handoff sample-2s and last handoff sample+2s. Size/basis MUST equal that
observation; never trust client size alone. Other statuses never create counts.
Manual/cloud photo approvals are not used as proof of a transfer. Keep existing
human rejections and source false positives excluded, not overwritten.

One record per original sourceEventId and eventId. Same-source retries/restarts
must never add an event. identity_ambiguous records point at possibleDuplicateOf;
they are withheld, not silently merged. The pilot cannot certify physical
reidentification between IDs and must disclose that limitation.

## Observation windows and non-comparability

windows: [{from,until,frames,droppedFrames}], timezone-bearing timestamps in
businessDate, from<=until; frames positive integer. Only live packets verified
against receiver wall time are recorded. Gaps>1.5s or a dropped-frame indication
start a new window. A single received frame observes a point, not a whole shift.
No windows means total:null, sizes:null, state:not_observed; do not write zero.
With observed windows and no estimated record, total0 is allowed ONLY labelled
for this partial observed interval. Display observation start, latest frame,
metadata gaps, and geometry/accuracy limitation prominently.
`coversWholeBusinessDay`, `physicalUniqueCountCertified`, `commercialAccuracyValidated`
are ALWAYS false. `scope` is directional_handoff_estimates_not_sales.
`requiresPerImageApproval` and `generativeAiUsed` ALWAYS false.

## Persistent storage and receipt

Use SAME site's private existing storage via proven strong-ETag conditional
adapter, NEW prefix `directional-handoffs/v1/store-{store}/{device}/{day}.json`.
Preserve sequence/hash collision checks, no omission of prior records, immutable
source identity/sample proof, monotone observation windows. A new revision may
update evidence/size/status after real source corrections, never change route.
No migrations or new database. Require persisted readback hash/sequence before ACK.

Receipt fields REQUIRED:
protocol=ojala_directional_handoffs_receipt_v1, persisted=true,
storeId,deviceId,businessDate,cameraName=handoff,sequence,documentSha256,receivedAt,
recordsPersisted,estimatedHandoffs,sizeBreakdown:{chico,mediano,pint,litro,unknown},
observedFrom,observedUntil,partial=true,countsAreSales=false,
physicalUniqueCountCertified=false,externalAiInvoked=false,requiredHumanAction=false.
For no windows, estimatedHandoffs/sizeBreakdown/observedFrom/observedUntil=null.
Otherwise counts recomputed SERVER SIDE from eligible records, not client totals.
Submission returns {success:true,receipt}; receipt-only returns {receipt|null}.

Admin query returns receipt fields plus windows, heldCandidateCount/statusCounts,
geometryCalibration, sourcePolicySha256, and records stripped of private storage
paths. Any stale/invalid native source should surface an error, not zero.

## UI requirement - actual user's requested location

INSIDE DailyOperationsPanel ('Cierre y conteo fisico revisado'), add primary
'Conteo automatico provisional de entregas' table with five capacity buckets and
observed interval, latest source frame, last receipt, connection state, unknowns,
identity holds, gaps and explicit not-whole-day/not-paid-sales text. Poll5s.
No approval button or closing-form dependency. Reviewed historical physical counts
and manual closing remain separate collapsible sections; never overwrite them.
No percentage/variance against full-day manual/POS for a partial/provisional count.
No data for a date remains 'No observado', NOT zero. Switching date must clear
wrong-day results. Keep all existing LIVE date/no-store fixes in de80ce33.

## Validation and shipping

Use synthetic fixtures only in tests. Tests must cover cross-tenant/model/day,
tampered hashes, static snapshot/track end, wrong direction, missing region samples,
gaps, duplicate IDs, late source rejection, size mismatch, partial zero and empty.
Do not send fixture documents to production. Source tests do not prove accuracy.
Do not install device code from the server task. Return source/checkpoint/test status;
publish ONLY after test/build/check PASS and source scope checked. The device owner
will be represented by the existing authorized account, no new memberships.
