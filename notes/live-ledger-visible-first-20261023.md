# Display received detections before missing closing or photograph panels

Diagnosis used an existing authenticated production Firefox tab, without opening
or navigating a new window: 2026-10-23 showed 13 native records, 10 locally
verified, 3 lacking same-frame evidence. That working panel was buried below
empty reviewed-count, manual-closing and photograph panels.

This change mounts the same native panel exactly once immediately after the date
selector, before the daily snapshot. It retains all raw/verified/repeat distinctions,
clearly labels the separate reviewed-turn count, and displays unknown capacities
as unclassified rather than distributing observations across sizes. Categories
with zero assignments but outstanding unclassified observations show Pending.
Missing same-day closing metrics now show Pending; real reported zeroes remain zero.
Photograph availability is explicitly separate from receipt of native detections.

Read-only UI and presentation helpers only. No API, schema, model, credentials,
transport, source records, counts, sales, review decisions, or migrations change.
This does not fix the separate browser-dependent photo transport or train sizes.
