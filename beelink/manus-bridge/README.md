# Manus official API bridge

This is a separate administrative evidence-transfer path. It does not bypass the
Cloudflare protection of the dashboard or claim to repair the direct Frigate POST.
It uses the documented `https://api.manus.ai/v2` file and task APIs.

## What it does

- Collects validated snapshots from `verified_snapshots/handoff` with their original
  metadata/geometry and hash-checked recording segments around each event.
- Writes a persistent, private ZIP plus SQLite outbox. A content fingerprint
  deduplicates repeated collection. Source queues, counts and receipts are untouched.
- Uploads to Manus using its returned presigned S3 destination, then continues the
  existing Ojala task. It requires that task to be private and idle.
- Asks Manus to use the existing authenticated administrative importer, retain
  `pending_review`, preserve prior decisions, and produce a read-back receipt.
- Distinguishes `awaiting_dashboard_receipt` from actual receipt. Neither upload
  nor agent acceptance sets `productionContractVerified` or acknowledges Frigate.
- Existing approved counts accompany the package only when the exact record is
  reproduced from its original ledger and all referenced evidence hashes validate.
  Manus must use the existing administrative count importer and read back its receipt.
- Holds ambiguous sends after timeout/crash and reconciles the batch marker against
  task history. No blind send retry. 401/403 pause the bridge; transient pre-send
  failures have bounded exponential retry (five attempts).

The worker never makes a count from number of images, tracks, POS or the reported
90% agreement. It does not approve evidence or declare a full day's coverage.
Human/visual review must still establish distinct physical cups before the existing
count-import contract can be used. No database migrations or website deploy.

## Installation on the Beelink

Copy these files to `/home/ojala/frigate/manus-bridge/` alongside the existing
`handoff-visual-sender/handoff_visual_sender.py` validator. Run tests first:

```
python3 -m unittest discover -s beelink/manus-bridge -p 'test_*.py' -v
python3 /home/ojala/frigate/manus-bridge/manus_bridge.py collect --date 2026-10-16
python3 /home/ojala/frigate/manus-bridge/manus_bridge.py status
```

Create a **new Manus API key** in `https://manus.im/app#settings/developers`, named
`Ojala Beelink`. This is not `FRIGATE_API_KEY`. Manus API keys have full access to
the owner's Manus account; agent execution consumes Manus credits. The masked
`configure_private.py` dialog validates identity/task access, narrows sharing of
the existing Ojala conversation to private using the documented `task.update`
API when necessary, and independently reads privacy back before saving the key
with mode 600 or scheduling collection at 22:15 plus bounded delivery checks.
This disables public/team sharing of that conversation, not access to the
published dashboard. A private audit receipt records the previous and verified
visibility. Only setup changes privacy; delivery still blocks shared tasks.
It does not change the existing direct sender hold. Keep the API key out of chat,
GitHub, screenshots and logs. No credentials are put in process arguments.

Once configured, run `manus_bridge.py send` for one existing batch and inspect
`status`. Until a real read-back receipt exists, delivery to the dashboard remains
unverified. Task busy, public sharing, missing auth, expired permissions, rate
limits, or a signed-upload destination outside the documented S3 flow fail closed.

## Operational limits

- It transfers evidence and, when already available, a reviewed unique-cup count.
  It does not create a new review or count; the existing administrative import contract applies.
- Candidate windows provide partial evidence, not a full-day recall measurement.
- Max 200 MB per package. Oversized packages stop rather than silently truncate.
- Metadata, packages and logs stay local. Only the authorized Manus account receives
  uploaded camera data. No raw key, signed URL, or API error body is printed.
- This code has isolated protocol/failure tests; live API authentication, file upload,
  agent execution and dashboard persistence must be checked on the actual account.

Official contracts: [authentication](https://open.manus.ai/docs/v2/authentication),
[file.upload](https://open.manus.ai/docs/v2/file.upload),
[file.detail](https://open.manus.ai/docs/v2/file.detail),
[task.sendMessage](https://open.manus.ai/docs/v2/task.sendMessage),
[task.listMessages](https://open.manus.ai/docs/v2/task.listMessages).

## Longer context for a review that cannot resolve short clips

`export_review_context.py` expands each original capture to 60 seconds before and
120 seconds after, merging overlapping requested intervals. It reads the archive
SQLite in read-only mode, checks the original package and segment hashes, and
copies original MP4s into a private package. It does not enqueue or upload it.

```
python3 export_review_context.py ORIGINAL.zip \
  /home/ojala/frigate/pilot-archive/forward-20260929 /private/REVIEW_CONTEXT
```

The output includes original segments, stream-copy playback derivatives, the
source package hash, per-segment wall-clock mappings, and every timestamp gap.
Playback splits at gaps or overlaps larger than 0.5 seconds; even smaller gaps
remain explicit in the manifest. Joined playback is not an original continuous
recording and must not conceal missing time. These candidate windows do not
establish whole-day coverage. Counts remain `null`, including when no unit has yet
been confirmed. A reviewer must distinguish unknown/unresolved from a true zero.

This review package is not a verified-snapshot or count-import payload. Attach it
to the existing authorized review task, preserving the original event identities;
do not repeat completed image analysis or create daily counts from clip totals.
Five focused tests cover interval union, missing time, overlaps and playback splits.

## Confirm the concrete October 16 partial proposal

`approve_manus_partial.py` verifies the existing two-cup draft, the exact source
ZIP and referenced hashes, prepares two temporal original-video anchors, then
opens the relevant video and asks the actual local operator to confirm the two
distinct filled cups with person and zone membership. The operator enters their
own name. Cancellation leaves the count unapproved; this flow never supplies a
reviewer's name on their behalf.

Only after that confirmation does it generate a partial review ledger, validate
and export the count through the existing local validators, and prepare an import
envelope. It keeps original evidence unchanged and refuses to replace an existing
approved record. It stages the new evidence/count package but makes no network
request and does not release the direct Frigate hold. This is a specific approval
of two units, not a full-day count or a substitute for the staff closing form.

The private API setup now records a sanitized `setup-state.json`: waiting,
cancelled, configured or failed with a safe error code. This distinguishes a
missing key from API rejection or a task-privacy problem without exposing the key
or response. No schedule is marked configured until installation succeeds.
