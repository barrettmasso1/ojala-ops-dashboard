# Ojala daily count transport — 2026-09-29

This is a new transport, not the missing original push script and not a new
object counter. It never converts ounces, tracks, photos, or POS into camera cups.

Installed paths on Beelink:
- `/home/ojala/frigate/scripts/frigate_push_counts.py`
- `approved_counts/YYYY-MM-DD.json`: persistent outbox records, pending or approved.
- `push_config.json`: private production configuration, never committed here.
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
Future dates fail. Current-day pending runs wait until 22:00 local time, as
requested by Barrett on 2026-10-02. Earlier retries cannot send today's count.

Production config must have mode 600 and contain the exact endpoint below,
`storeId: 1`, a valid server-issued `apiKey`, and an explicitly checked `protocol`
(`legacy_v1` or `tenant_event_v1`). Repository main does not prove deployment state.
Use `productionContractVerified: true` only after an accepted real payload.
For a newly supplied private credential, keep that flag false and explicitly set
`verificationMode: "first_approved_payload"` after confirming the deployed contract.
This permits only the same reviewed real records as normal operation; it does not
create a test count or bypass any count validation. Dry runs and failures leave the
flag false. A successful acknowledgment saves a receipt, then atomically records
verification in the mode-600 config. If that final write fails, the matching private
receipt can complete it on retry without sending the record again. Receipts are
bound to endpoint, store context, protocol and credential; old credentials cannot
verify new ones. When replacing a credential, reset the flag to false.
This acknowledgment does not verify the dashboard or multi-tenant isolation.

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
Partial coverage counts mean reviewed unique units only, never total deliveries.
A partial-coverage zero is rejected. Do not populate from POS or total photos.

### Partial evidence rollout (2026-10-08)

The old exporter required a complete shift review, and the old sender rejected
every partial count. Cron therefore ran without any approved outbox file.
The review CLI now has `--export-partial-to DIRECTORY`: it validates the original
evidence hashes and exports only confirmed physical-unit identities, excluding
ambiguous links. Original ledgers and pending cases remain unchanged. The output
is explicitly `coverage: partial`, with `dailyCupCount: null` and listed gaps.

Before enabling partial sends, verify the **published** dashboard uses the PR #12
coverage-aware card, labels the number `(partial)`, and does not compute a full-day
POS discrepancy from it. Only then set `dashboardSupportsPartialCounts: true` in
the private sender configuration. This capability does not assert that a count
was accepted or that tenant migrations ran. Keep `productionContractVerified`
false until a real acknowledgment. All partial records require `approvedAt`.
Do not enable the flag solely because GitHub main contains the UI code.

With `tenant_event_v1`, a reviewed correction can explicitly identify its accepted
predecessor with `supersedesRecordSha256`. It must use the same configuration and
a newer approval timestamp at whole-second precision; complete coverage cannot
be replaced with partial coverage. The prior receipt is retained under
`push_state/receipts`. Repeated payloads are not sent again. A network failure
preserves the last accepted receipt. Legacy corrections remain blocked until
explicit reconciliation; this change does not imply safe server-side ordering
for the legacy endpoint.

These are offline-verified changes. They do not themselves install the new sender,
activate its private configuration, submit a count, or certify production.

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
0 22 * * * /usr/bin/python3 /home/ojala/frigate/scripts/frigate_push_counts.py --pending >> /home/ojala/frigate/push_log.txt 2>&1
15,45 * * * * /usr/bin/python3 /home/ojala/frigate/scripts/frigate_push_counts.py --pending >> /home/ojala/frigate/push_log.txt 2>&1
@reboot /usr/bin/python3 /home/ojala/frigate/scripts/frigate_push_counts.py --pending >> /home/ojala/frigate/push_log.txt 2>&1
```
No unattended total generation is implemented; missing daily records are reported
as blocked and revisited. Logging/cron readiness does not mean the data reached
production. The sender must be connected to a validated physical-cup counter.

Validation: 28 local unittest cases; network responses are mocked in
tests. The forward-only run returns `no_pending_records` after the user retired
the old reconstruction. No cloud database, deployment, or dashboard was changed.
Future dates still need actual approved counts. On 2026-09-30 the user supplied
the private JSON from Manus; its verification note explicitly requires the first
real approved payload to succeed before setting the verification flag. Manus also
reported the published legacy contract and absence of store isolation; the first
payload mode addresses that bootstrap without claiming a prior successful send.

Repository main on 2026-09-29 stores an integer and displays it directly; it does
not convert camera cups to ounces or deduplicate physical units. Its legacy
delete/insert upsert is not atomic. Before enabling retries in production, verify
the deployed store binding and safe same-date update behavior, including failed
requests. Do not claim production idempotency from local tests.

Rollback: remove only the three lines containing this new script and its comment
from the current crontab. Keep the outbox, logs, and receipts. Do not restore the
entire backup over unrelated jobs added afterward.

### Explicit client-access block (2026-10-09)

The real October 4 partial was attempted on October 9 at 15:15:52 America/Mazatlan.
The public POST returned HTTP 403, without acknowledgment. A subsequent read-only
GET to the same endpoint returned `Server: cloudflare` and `error code: 1010`.
This is a client-access block, not proof of a bad API key or a rejected cup count.

Sender 2026-10-09.1 detects that bounded 403/Cloudflare/1010 combination without
logging response bodies and creates `push_state/transport-hold.json` (mode 600).
Further sends stop locally with `cloudflare_1010`. The cron and outbox remain
intact; transient network errors, HTTP 429 and HTTP 5xx still retain retry behavior.
Do not change fingerprints, routes, or security controls to bypass the block.
The site administrator must resolve the supported authenticated API access path;
then archive the hold file and retry the same reviewed record. An acknowledgment
still does not certify dashboard display or tenant isolation.

The partial display capability was enabled from the user's explicit confirmation,
recorded as `user_attestation`, not independent agent UI verification. The available
browser still redirected to Manus login. `productionContractVerified` remains
false after the rejected attempt. No zero/test count, migration, or production
deployment occurred. Tests: 41 sender cases plus the existing 17 review cases.
