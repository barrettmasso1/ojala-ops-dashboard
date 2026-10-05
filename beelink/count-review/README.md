# Review physical cups from preserved video

`build_review_frames.py` extracts timestamped frames from the preserved archive,
checks original segment hashes, and records gaps. Contact sheets are analytical
crops; full frames and segment provenance remain available. Extraction is not
object detection or a complete video review.

`review_counts.py` validates a reviewer-authored ledger. It verifies frame hashes,
day/camera/store, unique physical unit IDs, temporal evidence, and the partition
of Frigate/Rescue candidates into cases. Multiple tracks can link to one cup;
several cups can link to one scene. A photograph does not approve a delivery.

Audit, without creating an outbox record:

```sh
python3 review_counts.py /path/to/review-ledger.json --evidence-root /home/ojala/frigate
```

Only after a full operating-window review, resolved identities, complete
coverage, and explicit dated approval can `--approve-to /path/to/approved_counts`
export a daily record. Existing records cannot be overwritten. The sender is a
separate process; this utility performs no network calls.

Candidate-window reviews report `confirmedUniqueCupsInReviewedEvidence` and
leave `dailyCupCount` null. Missing manual/POS counts remain missing. Do not mark
coverage complete because most of the video exists, or because every detector
candidate was reviewed: missed detections require independent ground truth.

## 2026-10-05 validation

- Extracted 399 frames from 15 Sunday 2026-10-04 candidate/detail windows on the
  Beelink. No requested samples were missing and no frame decode failed within
  these windows. This does not establish full-day coverage.
- Reviewed 36 candidates (24 Frigate tracks plus 12 Rescue captures), using 82
  hashed evidence files in the review ledger.
- Visual review establishes 13 distinct filled cups in reviewed evidence. Two
  cases remain unresolved: bowls changed to paper cups around 13:09, and a child
  appearing with an additional cup around 17:14. Daily count is NOT approved.
- 12 ledger tests and 30 sender tests pass locally and on the Beelink.
- Sender 2026-10-05.1 is installed with a backup. It rejects partial totals
  because the current production tile hides coverage. Credentials and cron were
  not changed. Production received no count from this review.

Private evidence lives only on the Beelink:
`/home/ojala/frigate/pilot-reports/2026-10-04/video-review/`.
Do not commit customer photographs or private configuration to GitHub.
