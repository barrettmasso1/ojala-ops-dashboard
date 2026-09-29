# Ojala daily count transport — 2026-09-29

This is a new transport, not the missing original push script and not a new
object counter. It never converts ounces, tracks, photos, or POS into camera cups.

Installed paths on Beelink:
- `/home/ojala/frigate/scripts/frigate_push_counts.py`
- `approved_counts/YYYY-MM-DD.json`: persistent outbox records, pending or approved.
- `push_config.json`: private production configuration (not supplied).
- `push_state`: durable result and acknowledgment records.
- `/home/ojala/frigate/push_log.txt`: actual execution output.

Run an explicitly reviewed business date:
```bash
cd /home/ojala/frigate/scripts
source .venv/bin/activate
python3 frigate_push_counts.py --pending
```

No date defaults to the previous local calendar day. `--pending` retries the
outbox, known failed days, and elapsed Fri-Sun business dates for up to 30 days
since 2026-09-27. Known outbox/failed days remain eligible beyond 30 days. This
matches the installed opening schedule; change schedule logic if opening changes.
Future dates fail. Current-day pending runs wait until 21:00 local time.

Production config must have mode 600 and contain the exact endpoint below,
`storeId: 1`, a valid server-issued `apiKey`, `productionContractVerified: true`,
and an explicitly checked `protocol` (`legacy_v1` or `tenant_event_v1`).
That flag must only be set after the deployed runtime's contract and store binding
are checked; repository main does not prove deployment state.

For `tenant_event_v1` (the reviewed PR stack), records also require a real
offset-aware `approvedAt`. The sender normalizes it to UTC Z and emits a stable
`daily-reviewed-...` sourceEventId from the immutable approved-record digest.
This identifies an approved aggregate, not a fabricated Frigate cup event. A
`stale` server response is blocked, not acknowledged as the current dashboard
value. Only explicit `apply`/`replay` confirms acceptance of that event identity.

Endpoint: `https://ojaladarsh-m6piugsr.manus.space/api/trpc/frigate.submitCounts`

Approved records require the matching date, `cameraName: handoff`, `storeId: 1`,
`status: approved`, `countBasis: reviewed_unique_physical_cups`, integer
`cupsDetected`, distinct `uniqueCupIds` of the same cardinality, `reviewedBy`,
`evidenceReferences`, and coverage `complete` or `partial` (with gaps description).
Unique cup IDs are reviewed physical units, not raw Frigate event IDs. A schema
check cannot certify a review: an actual reviewer/counter must supply the evidence.
Partial coverage counts mean detected unique units only, never total deliveries.
A partial-coverage zero is rejected. Do not populate from POS or total photos.

`push_state/retired_dates.json` maps excluded ISO dates to explicit reasons.
Retired dates are excluded even if outbox/history files remain. Explicit `--date`
also returns `retired` without reading credentials or posting. Invalid retirement
state fails closed. The user retired the old reconstruction on September 29;
historical files remain as evidence and cannot trigger further retries.

JSON POST uses the repository's tRPC/SuperJSON contract. Redirects are refused.
HTTP 200 alone is not success: the expected acknowledgment must be present.
Response bodies, API keys, and exception messages are not logged. Acknowledged
records are not resent, changed acknowledged records require reconciliation,
and errors preserve the outbox. A file lock serializes invocations. Atomic/fsync
receipt writes protect local state. API acknowledgment is separate from dashboard
verification: `dashboardVerified` remains false until checked independently.

Cron additions (existing jobs preserved, original crontab backed up):
```cron
10 21 * * * /usr/bin/python3 /home/ojala/frigate/scripts/frigate_push_counts.py --pending >> /home/ojala/frigate/push_log.txt 2>&1
15,45 * * * * /usr/bin/python3 /home/ojala/frigate/scripts/frigate_push_counts.py --pending >> /home/ojala/frigate/push_log.txt 2>&1
@reboot /usr/bin/python3 /home/ojala/frigate/scripts/frigate_push_counts.py --pending >> /home/ojala/frigate/push_log.txt 2>&1
```
No unattended total generation is implemented; missing daily records are reported
as blocked and revisited. Logging/cron readiness does not mean the data reached
production. The sender must be connected to a validated physical-cup counter.

Validation: 21 local unittest cases; network responses are mocked in
tests. The forward-only run returns `no_pending_records` after the user retired
the old reconstruction. No cloud database, deployment, or dashboard was changed.
Future dates still need actual approved counts and verified private configuration.

Repository main on 2026-09-29 stores an integer and displays it directly; it does
not convert camera cups to ounces or deduplicate physical units. Its legacy
delete/insert upsert is not atomic. Before enabling retries in production, verify
the deployed store binding and safe same-date update behavior, including failed
requests. Do not claim production idempotency from local tests.

Rollback: remove only the three lines containing this new script and its comment
from the current crontab. Keep the outbox, logs, and receipts. Do not restore the
entire backup over unrelated jobs added afterward.
