# Independent handoff capture in shadow mode

This companion addresses a specific failure: the verified capture worker only
examines cups that Frigate already reported. A missed first-stage event therefore
produces no photograph for visual review. This worker examines the live handoff
image independently and keeps eligible evidence **pending review**.

It is not a delivery counter or the cloud visual filter. It never calls the
dashboard, writes Frigate's database, changes camera configuration, or places
images in the verified sender directory. No migration is required.

## Behavior

- Reuses the exact v4 ONNX weights and validates their SHA-256 at startup.
- Preserves the full camera frame, pads the square at the bottom/right, then
  uses RGB float/255 input. Crops around the counter failed the selected real
  positives; this preprocessing recovered the missed-scene frame.
- Requires a cup score of at least 0.45 (or the active higher threshold), cup
  bottom-center inside the actual polygon, allowed area, and a person in the
  **same JPEG**. It never lowers Frigate's thresholds.
- Samples every 3 seconds and requires two consecutive eligible samples with
  one-to-one association. NMS removes duplicate boxes; multiple separate cups
  can retain separate tracks. A track is not a delivery.
- Uses a separate SQLite journal with FULL synchronous WAL, atomic image/JSON
  publication, restart deduplication, and recovery of complete pairs after a
  crash between file publication and database commit.
- Live origin is `independent_live_shadow`; replay origin is
  `recording_extracted_frame`. Both have `cup_event_id: null` and
  `status: pending_review`. These are intentionally NOT inputs to the current
  `submitHandoffVisual` endpoint. A separately reviewed server contract is needed.
- Flags nearby already-published verified captures as possible duplicates.
  Later-arriving primary captures and reappearing cups still require review;
  cross-source delivery deduplication is not certified.
- Uses one CPU inference thread at nice 15. It pauses when primary camera or
  processing FPS fall below 4.5, skipped FPS exceed 0.7, disk is low, or the
  512 MiB evidence cap is reached. It preserves evidence rather than deleting it.
- A zone/configuration change stops the worker. The supervisor starts only
  alongside an already-running Frigate during the existing Friday–Sunday
  12:00–21:00 schedule. It never starts Frigate or changes that schedule.

## Local layout

Container code: `/config/rescue_shadow/`.
Host code: `/home/ojala/frigate/config/rescue_shadow/`.
Pending pairs and separate SQLite: `state/pending/`, `state/shadow.sqlite3`.
Health: `state/health.json`. Supervisor: `supervisor.json`.

The enable manifest must contain `model_sha256` and `geometry_sha256` matching
`load_geometry()` and the validated model. It is generated on the target after
the offline validation; it contains no camera or server credentials.

Host supervision entry (the installed crontab was backed up first):

```cron
* * * * * /usr/bin/python3 /home/ojala/frigate/config/rescue_shadow/launch_shadow.py > /home/ojala/frigate/config/rescue_shadow/launcher-latest.json 2> /home/ojala/frigate/config/rescue_shadow/launcher-error.log
```

To pause this companion while preserving all evidence, rename its enable file:

```bash
mv /home/ojala/frigate/config/rescue_shadow/enabled.json /home/ojala/frigate/config/rescue_shadow/disabled.json
```

The worker exits after its current bounded operation. To restore, rename the
same file back after confirming the model and geometry have not changed; the
supervisor will start it. Do not run this rename over an existing destination.
The main Frigate and verified capture workers are unaffected.

## Executed evidence, 27 September 2026

- Ten shadow tests passed locally and on Beelink, including two-cup association,
  person gate, temporal continuity, load pause, restart deduplication, and
  recovery after a lost SQLite commit.
- Five selected real photographs: three positive image gates admitted, lamp
  negative rejected, no-person negative rejected. This is a small, selected
  acceptance set and is not a commercial precision/recall measurement.
- The two-cup photograph still produced only one high-confidence model box.
  The full photo contains both cups; a visual reviewer/cloud model must assess
  multiplicity. Exact cup count is not solved by this change.
- Original video hash:
  `7f73aa3481abe959f8ff0af6ed2be28867a1d0704e366aa546bd60eda3104b85`.
- Missed-scene replay, offsets 330–366 seconds, twelve samples: three eligible
  frames and one persisted pending-review image at offset 360 (approximately
  17:02:52 local; camera overlay 17:02:51). The cup box score was 0.81183.
- Second-scene replay, offsets 471–507 seconds, twelve samples: **zero eligible
  frames**. The independent gate is incomplete and complements the primary
  capture. The earlier primary still image from that scene passes separately.
- Activated on Beelink at **18:35:25 America/Mazatlan** in shadow mode. It paused
  on low primary FPS, then sampled normally while primary FPS returned to 5.1.
  Live sales accuracy and cloud end-to-end behavior remain unverified.
- By 18:40:47, it had processed 91 live samples without errors or eligible cups.
  Zero live screenshots in that interval is not a statement about sales.
- A deliberate graceful restart of this companion was recovered by the cron
  supervisor at 18:41:03. The new worker had a fresh heartbeat, SQLite quick_check
  passed, and Frigate's start timestamp and configuration hash were unchanged.
- The auditor's eleven tests also passed locally and on Beelink. Two specifically
  prevent an offline replay/legacy burst from being reported as the live worker.

Private fixture images and video are not committed. On Beelink, executed
results remain under `/home/ojala/frigate/config/rescue_shadow_tests/`.

Tests:

```bash
python3 -m unittest discover -s beelink/rescue-shadow -p 'test_*.py' -v
python3 -m unittest discover -s beelink/pilot-tools -p 'test_*.py' -v
```

The pilot auditor distinguishes `live` workers from offline `replay` commands
and reports shadow mode/heartbeat explicitly. `rescue_delivery_validation_pending`
remains a blocker even while this worker is running.
