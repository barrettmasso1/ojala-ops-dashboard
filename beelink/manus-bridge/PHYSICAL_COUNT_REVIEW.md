# Automatic partial physical-count review

The visual bridge could transport an existing reviewed count but did not generate one. `physical_count_review.py` adds a separate, persistent video-review job to the existing private Manus task. It does not sum snapshots, AI image counts, tracks, POS or manual totals.

## Flow

1. The existing bridge archives and uploads an original daily package.
2. The review worker reuses that uploaded file in the same private task. Manus reviews original temporal video and returns a structured AI-attributed ledger. This step cannot write a production count.
3. Locally, the worker verifies the source ZIP/manifest/file hashes; exact store/date/camera/candidate universe; original video membership and frame bounds; distinct temporal anchors; candidate partition; physical-unit decisions and duplicate relationships. The existing `count-review/review_counts.py` validator exports only positively supported partial units.
4. Original response and normalized ledger are retained. Only video paths are rebased to immutable local copies. An existing local approved count or registered administrative count is preserved.
5. A new approved-count file enters the existing bridge, which revalidates the entire ledger and imports its exact canonical record through the authenticated administrative flow. The pre-existing Frigate/Cloudflare sender remains held.
6. Only the existing verified receipt collector can mark the new count batch received. Upload acceptance or a review response is never a dashboard receipt.

This is AI-assisted video review over candidate windows, not a newly trained detector or a full-day count. Integrity tests cannot establish model accuracy. Partial counts must not become sales, ounces, deliveries or decisive discrepancies. If no physical units are supported, no daily zero is created. The reviewer is always `Manus AI — video review`, never the name of an operator who did not review the evidence.

## Operation

Installed module: `/home/ojala/frigate/manus-bridge/physical_count_review.py`.
Settings: `manus-bridge/state/physical-reviews/settings.json`, owner-only JSON with `enabled`, `startDate` and `policy: physical-partial-video-review-v1`.

- `python3 physical_count_review.py request --date YYYY-MM-DD` requests one review of an elapsed day. Explicit backfills are allowed; automatic catch-up is limited to seven days and `startDate`.
- Add `--replay` for review/validation only: it cannot publish a local approved count or enqueue an import.
- `python3 physical_count_review.py run` collects responses and receipts, recovers an interrupted publication, and dispatches eligible daily reviews when enabled.
- `python3 physical_count_review.py status` reports persisted review jobs.

Suggested cron: `5,35 * * * * /usr/bin/python3 /home/ojala/frigate/manus-bridge/physical_count_review.py run >> /home/ojala/frigate/manus-bridge/state/physical-review.log 2>&1`.
The shared bridge lock prevents simultaneous workers. Existing collection at 22:15, sender at :25/:55 and receipt reconciliation at :20/:50 are retained. The review worker gives its outstanding count import priority before another review request.

A send with an uncertain response stays `dispatching` and is not repeated. A returned attachment can still reconcile it after a crash. A validated ledger is recovered from disk without needing another AI request. Uploaded files that have expired are reported unavailable instead of silently uploading new material. Private-task checks and existing API authentication holds remain enforced.

Review evidence is stored under `pilot-reports/DATE/automatic-count-review/JOB_ID/`. Job states are under `manus-bridge/state/physical-reviews/JOB_ID/`. Previously verified administrative counts may be protected using `physical-reviews/existing-production/DATE.json` with the retained receipt and row identity.

## Rollback and validation

Remove only the review-worker cron line and disable new review requests in its settings. Preserve its jobs, originals, approved counts and receipts; the existing visual transport continues independently. `enabled:false` prevents new scheduled requests, but permits reconciliation of a review already explicitly requested.

Run the Python bridge test directory. Cases cover source tampering, photo-as-video rejection, temporal/date bounds, duplicate candidates, partial-only/AI attribution, no zero from ambiguous evidence, immutable existing counts, uncertain-send deduplication, recovery after interruption, replay mode and receipt gating. Test fixtures are synthetic validator inputs and are not accuracy evidence. A real archived-video run must be reported separately before claiming production acceptance.
