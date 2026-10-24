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
