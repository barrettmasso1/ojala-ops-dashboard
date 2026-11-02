# Verified external resume - Ojala Store 1

Site-specific recovery adapters, not a new application or a new model.

On 2026-11-02 the original filesystem UUID reappeared at /tmp/externo. The
internal emergency guard correctly refused to run without reconciliation;
services were repeatedly restarting while the internal disk was below its 8 GiB
reserve. Kernel boot logs reported journal recovery complete. No unmounted full
fsck or adapter replacement was verified, so neither is claimed.

Recent internal queues remain intact. Five SQLite databases were copied with
SQLite backup into a new external namespace, independently integrity-checked,
and compared table-for-table. All 136 prior photo rows, attempts and receipts
were preserved. Old external observations are a subset of the recent queue.
No historic database or evidence was overwritten. Original disk-based workers
remain excluded; the same existing service names now point at the new root.
The kernel mount UUID, RW/shutdown state, errors_count, 8 GiB free reserve and
256 MiB agent allocation cap are checked before writes. Startup fails closed.

collector.py retains the installed classifier/detector behavior and prioritizes
the current business date before historical reconciliation. Historical results
do not overwrite the current-day heartbeat. The migrated code is a deployment
adapter and requires the existing ledger.py, size_runtime.py and related modules.

Validation run: 14 mount/storage tests; 94 collector/ledger/startup tests;
61 published comparison/presentation tests. Tests use fixtures, not live writes.
No tested source file or README contains machine credentials or customer photos.

Rollback: stop these services before any path change; reconcile the latest
revisions and exact server receipts before selecting any earlier queue. Do not
blindly restore the retained pre-migration queue or restart historical workers.
