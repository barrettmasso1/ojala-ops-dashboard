# Optical pickup runtime readiness, not certified sales

This integrates previously staged local optical-pickup sources. Local side:
42 core/job tests pass. Server side: 16 focused tests pass. The native detector,
model, thresholds, owner calibration references, original clips, and prior image
receipts are unchanged. The worker follows actual recorded motion; it cannot
infer a paid sale or manufacture size labels. It remains provisional.

Corrections made during review: preserve the full observed path rather than
truncate after a crossing (a returned cup must not count); exclude subsequently
rejected jobs without deleting their stored evidence; accept actual adjacent
recording ranges overlapping <=0.5s while rejecting reversed/duplicate/large
ranges; avoid dereferencing a previously excluded duplicate in the server.

The service must pause at >=83 C, degraded primary process FPS, unavailable
thermal state or unavailable external disk. No guard is weakened to create a
success. Current-day queue is the default; no old-day backfill is requested.
The installed detector remains v4. A missing/no-window result is not zero sales.
