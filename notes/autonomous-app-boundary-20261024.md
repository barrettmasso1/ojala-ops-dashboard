# Autonomous Ojala app boundary

Incident: October 23 metadata arrived (57 tracks), but the legacy 22:25/22:55
sender had been disabled while its replacement native-photo worker was not yet
activated. Collection at 22:15 created a local package of 33 images / 106 segments,
not an uploaded batch. Manual closure subsequently persisted 19 containers.
There was no validated unique camera count or automatic comparison; publishing
metadata successfully never proved the full commercial workflow was complete.

This change creates one lifecycle entrypoint and a truthful health aggregation,
plus independently tested reconciliation guards. 33 unit tests pass without
production sources or network. No production quantities are mutated. Image
transport acceptance, source publication and actual dashboard verification must
be recorded separately; a merged branch is not proof of deploy or service health.

A further observed defect: four October 23 photos were saved after the end of
the event to which they were attached. The auxiliary capturer now rechecks the
same event after local inference, preserving the original end+2s validation
window. Fifteen lifecycle tests and an audit of 33 genuine historical sidecars
identify 29 valid / 4 invalid associations. Existing images are not rewritten.
Frigate itself, detector, zone, thresholds and original event IDs are unchanged.
Only the auxiliary capturer was gracefully restarted after a backup and a check
that its retention cleanup would delete nothing. New heartbeat/source hash was
verified. The main camera container was not restarted.

The aggregated monitor exposed another previously invisible issue: the calibration
unit was active but its assessments heartbeat had been stale for three hours.
Its journal contained StorageError without a safe reason code. A fresh UUID and
free-space check passed. A bounded restart recovered periodic updates while
model, owner-review index and all 23 owner labels remained byte-identical.
The logger now records only whitelisted storage error codes, no paths or secrets.
The exact historic storage exception was not recoverable from the old logs; no
claim is made that restart diagnosed its deeper cause. Runtime monitoring keeps
this failure visible if it recurs. Reserve/UUID checks remain unchanged.

The collector sidecar verifier used a fixed Mexico timezone even when the tenant
configuration declared another zone. The collector now passes its configured
zone into the calendar check. Five tests cover Tokyo/UTC/Mazatlan boundaries
and keep the end-of-event timing guard intact; 117 collector/transport tests
pass. Ojala's own timezone and historical records are unchanged.

Final UI audit found an important future false-comparison risk: same business day
and a complete-coverage flag were sufficient for a percentage, even with no
actual manual/camera interval bounds. The comparison now requires equal explicit
timezone-bearing observationPeriod startedAt/endedAt timestamps. No historical
period is invented. Native sums must also match the usable observations, and
manual totals use exactly the four known sizes. 21 comparison/panel tests pass
including 11 new period/coherence cases. Friday actual data remains non-comparable
for a validated physical delta, while its manual and observed quantities show
side by side. No sales/count rows or camera thresholds are changed.
