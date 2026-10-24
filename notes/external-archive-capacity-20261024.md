# Preserve camera evidence before the legacy archive quota fills

The 16 GiB archive quota had only 157 MiB remaining while the UUID-verified
external disk had 335.82 GiB free. The authorized repair raises only this external
archive quota to 32 GiB. The 8 GiB free-space reserve, mounted-filesystem identity
check, read-only Frigate input and prohibition on evidence deletion are retained.
The original archive_recordings.py is unchanged. A narrow wrapper validates a
bounded external-only capacity policy before calling the existing archiver.

Actual first run: 4 new segments, 0 missing sources, 0 errors; quota 32 GiB,
reserve 8 GiB. No camera schedule/model/threshold change, no original files
deleted, and no claim of decoded video integrity or validated physical counts.
The cron keeps its five-minute cadence at lower CPU priority.

The unified health monitor now includes archive freshness, paused/error states
and a warning at 95 percent quota use. This prevents a healthy metadata sender
from concealing a stopped evidence archive. Eight policy tests and 51 aggregate
agent/comparison/lifecycle tests pass. All backups stay on the external disk.
