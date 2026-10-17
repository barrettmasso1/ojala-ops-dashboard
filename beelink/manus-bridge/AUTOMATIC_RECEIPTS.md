# Automatic administrative receipt verification

`manus_bridge.py reconcile` now also retrieves and validates real administrative read-back receipts. `receipts --recheck-receipts` can revalidate already acknowledged batches without uploading or importing again.

The collector uses the official private task's `task.listMessages` attachments. It only downloads matching receipt JSON names from private Manus CDN HTTPS URLs, never forwards the API key, follows no redirect, bounds size, and never stores signed URLs as identity. It checks the exact ZIP and manifest hash, Store 1, business date, camera, every original event and unique persisted ID, allowed visual provenance/status, and read-back time after dispatch. If an original reviewed count was included, the persisted count must preserve quantity, coverage, original record hash and source event identity/time. A previously persisted deduplicated count may precede the new batch upload.

Validated receipt content and a local proof are written privately before SQLite acknowledgement. An expired URL, malformed/incomplete receipt, wrong date/store/hash, extra count, duplicate/missing event or task acceptance alone cannot acknowledge a batch. Pending batches remain pending and are not blindly resent. The result is explicitly administrative read-back, not a database signature, direct Frigate POST verification, photo-to-cup conversion or a full-day total.

Run `python3 -m unittest discover -s beelink/manus-bridge -p 'test_*.py'`. Installation validated 55 tests and independently downloaded/validated both existing real batch receipts on 2026-10-17 without any production write. `receipt.automatic.json` and `automatic-verification.json` are stored beneath `state/receipts/<batch>/`.

Official references: https://open.manus.ai/docs/v2/task.listMessages and https://open.manus.ai/docs/v2/attachments.
