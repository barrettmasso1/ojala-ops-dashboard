# Deterministic SQLite read connection closure

Production diagnosis on 2026-10-25: calibration PID had 1020 file descriptors,
1017 pointing at SQLite; the photo sender had 386 descriptors and about 153 MiB
in its service cgroup after seven restarts. Both repeatedly used `with
sqlite3.connect(...)` as though it closed the connection. That manager only
commits/rolls back. GC-delayed connections caused findmnt spawning/storage checks
to fail, not an actual missing/full external disk.

Only two read paths now use contextlib.closing. Tests retain Connection objects,
disable cyclic GC, perform 300 polls, and prove closure on success, SQL error and
invalid JSON. No credentials, DB schema, thresholds, source data or labels change.
188 collector/photo tests and 78 calibration tests pass. Installed copies were
checked against the exact tested patch; original model and owner-reference hashes
are unchanged. Queue backups remain on the guarded external volume.
