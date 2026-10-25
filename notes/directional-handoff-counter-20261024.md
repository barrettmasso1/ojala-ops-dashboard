# Provisional directional handoff counter

Read-only internal Frigate frame metadata (version 0.17.2), rather than the sparse
historical path_data or one thumbnail per event. No new inference, no camera/model
or threshold change, no browser, no generative AI, no sale/closing mutation.

Real metadata collection started 2026-10-24 18:30:52 America/Mazatlan. Before this,
the full trajectories were not recorded: no historical handoffs are invented.
Geometry extends the actual configured handoff polygon toward the near staff side
and far customer side visible in an actual camera frame. Geometry remains explicitly
provisional_visual_orientation and is NOT commercially validated. Test polygons
are separate synthetic fixtures and were NOT deployed.

The counter requires a continuous origin -> handoff -> destination route with two
samples at each edge, no >1.5s gap, current tracker samples and original same-event
local image/person evidence at the crossing. IDs/messages do not become new counts.
Static objects, inverse paths, ends, predicted stale samples and missing identity
remain withheld. Potential cross-ID duplicates within15s are withheld, not merged.
Known local/owner size labels are reused; unknown remains unknown. Source false
positives never reapprove themselves from stale metadata.

One authenticated existing backend stores provisional snapshots separately from
certified reviewed counts. All totals are estimates over known observed intervals,
not receipts, sales or the full day. Preserve original native counts/photos/manual
sources and all earlier bootstrap/order fixes. See CONTRACT.md for exact API.

58 local software tests pass using explicitly synthetic fixtures. They are not a
measurement of accuracy on real handoffs. The real first run observed1569 frames,
no tracked objects crossing; zero relates only to that partial observed interval.

During deployment QA the new processor exposed a read-connection lifecycle leak.
Each readonly SQLite handle is now explicitly closed in success/failure paths,
with two regression tests. Verified open source handles fell from99+99 to0 and
memory stabilized near20MiB. Streaming detector hash verification and retained
sanitized failure reports avoid hidden restart causes. Full local suite60 PASS.

First production activation found that reading a receipt before its first object
existed returned HTTP500, with ZERO dispatch attempts. The sender now issues a
conditional create exactly once for a never-dispatched snapshot; any uncertain
write is still reconciled by receipt only. The real first snapshot was accepted
and independently read back, then the autonomous service advanced to sequence5.
No fixture, photograph or detector-track total was promoted to a handoff.
Latest local suite69 PASS; unified monitor60 PASS. Zero accepted routes so far is
limited to the real observed interval, NOT the whole day or a precision result.
