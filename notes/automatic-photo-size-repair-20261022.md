# Automatic photographic recovery and size observations

## Actual failure classification
The browser relay was active with every one of the seven verified stills persisted.
The local secondary cup filter rejected candidate tracks; this is capture exclusion,
not a new Cloudflare failure. A read-only recording inspection showed serving vessels
in a rejected interval. This patch does not change v4, camera geometry or thresholds.

## Recovery
A bounded companion recovers original video frames for completed in-zone cup tracks
without a verified still. It groups adjacent same-position tracks to avoid redundant
recovery frames, checks source recording SHA256 and geometry provenance, assigns a
separate rec-YYYYMMDD ID, and uses the existing administrative recovery import.
These rows remain recording_extracted_frame, never verified_snapshot, never deliveries.
The original still sender stays prioritized. Recovery pauses at 83 C, stores heavy
outputs on the UUID-verified external disk and preserves original recordings.

## Automatic size analysis and dashboard
A separate tenant-scoped server action analyzes persisted images without changing
visual approval, manual annotations, count rows, sales, inventory or capture provenance.
It excludes empty display/sample containers, distinguishes printed capacity from
explicit uncalibrated visual estimates, and leaves ambiguous containers unknown.
No physical calibration or validation accuracy is claimed. A compare-and-swap lease,
readback, three-attempt cap and retry delays protect concurrency and costs. Manual
annotations are never overwritten. Photo delivery does not wait on this vision job.

The new dashboard table aggregates photographic observations by chico, mediano, pint,
litro and unknown, separating printed, estimated and manual-photo annotation columns.
Discarded rows are excluded. Repeated identical image hashes are not repeated. The same
physical serving can still appear in different images; these are NOT daily unique
cups and must NOT be added to manual closing or Shopify. Missing data remain pending.

## Scope
No production migrations, model changes, thresholds, auth changes or invented fixture
writes. Existing browser-owner session remains required; expiration is an explicit
operational limitation, not silently bypassed. Source-only tests do not prove new
production endpoints or a published build until verified after publication.
