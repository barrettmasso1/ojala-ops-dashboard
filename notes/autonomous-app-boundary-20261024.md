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
