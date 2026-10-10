# Forward pilot readiness — 2026-09-29

The user retired the prior-day reconstruction. Preserve its evidence, exclude
it from push retries, and work on subsequent shifts.

## Live local changes

- The capture guard follows an already running Frigate even outside Fri–Sun.
  It can still start a stopped Frigate only during the original Fri–Sun 12–21
  schedule. The separate start/stop cron jobs are unchanged.
- Rescue supervision follows the running container on any day; it cannot start
  Frigate. Its CPU/FPS, geometry, disk and retry guards are unchanged. Candidates
  remain pending review; they are neither delivered cups nor confirmed sales.
- The auditor can run with `--if-running`, so manual sessions are documented
  without starting services during closed hours.
- `archive_recordings.py` copies finalized handoff segments into
  `/home/ojala/frigate/pilot-archive/forward-20260929/recordings` and records SHA-256,
  time bounds and provenance in its own SQLite index. Frigate's DB is read-only.
  Copying waits 45 seconds after the recorded end, fsyncs, verifies bytes and
  resumes unindexed copies after a power cut. It neither changes camera/model
  settings nor restarts Frigate.
- Archiving begins at 2026-09-29 00:00 America/Mazatlan. Each run catches up to
  600 files/45 seconds from the last 48 hours; a five-minute cron catches up after
  outages. Missing files are reported, never inferred as covered.
- Archive budget: 16 GiB maximum and 8 GiB minimum free. Existing archived files
  are not automatically deleted. A limit pauses new copies and appears in the
  audit blockers. This is protection from Frigate retention on the SAME disk,
  not protection from disk failure or a promise of seven full days.

## Deployment and operational gates still required

The image sender stays queue-only until the published store-bound authentication
and receiver are verified. The count transport cannot derive physical cup IDs
from raw tracks, still-image counts or POS. A reviewed physical-cup producer,
actual ground truth and a production end-to-end verification remain required.

PR #9 and #10 are open as of this check. Their existence and synthetic/isolated
tests do not demonstrate a deployed production feature. Resolve the complete
stack and exact migration order with the owner, Barrett; never reapply old SQL
blindly or set a verification flag from preview evidence alone.

## Rollback

The Beelink installation keeps pre-change files and crontab in
`/home/ojala/frigate/pilot-tools/backups/forward-20260929/`.
Restore only each changed script from that directory as necessary. Remove only
the archive cron line to pause future copies. Preserve its index and recordings.
Restore the original audit schedule if reverting the manual-session behavior.
Retirement is deliberate: do not remove the excluded date without new user intent.
