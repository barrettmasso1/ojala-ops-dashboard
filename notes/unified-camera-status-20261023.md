# One native camera source, explicit independent missing states

Observed in the existing authenticated dashboard: the native register displayed
28 tracks, 2 owner-confirmed small and 4 owner-confirmed medium observations,
while a second similarly titled photo-only size panel displayed pending. Closing
cards also used the same generic pending wording because no closing was saved.

This patch is display-only. The native register remains the authoritative camera
size view. The historical photo classification table is explicitly an archive
inside a disclosure, not a second current camera total. Photo transport remains
visible and is not falsely declared repaired. Missing manual closing values say
no closing is registered; they are not zero and are never filled from the camera.
Unassigned categories are distinguished from pending transport. A matching-date
last-known register survives a transient fetch error with an explicit stale-data
warning; mismatching dates and inconsistent size totals cannot show as current.

No credentials, API, schema, SQL, model, camera, thresholds, records or transport
are changed. The independent manual/closing and physical-delivery totals remain
separate. This is NOT a calibrated four-size detector or validated delivery count.

Validation on Beelink: 59 focused tests PASS including 21 new rendering/data-state
regressions. A low-priority CPU-limited TypeScript check was stopped when the live
camera health read 1.4 process FPS / 88 C. Full app tests, TypeScript and build must
run in the authorized development environment before merge/publication. Do not
run more heavy checks on the live camera host. No browser windows were opened.
