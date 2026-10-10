## Problem

Camera cup count remains empty because the exporter required a complete daily review before creating an approved outbox record, and the sender independently rejected partial coverage. The 22:00 cron ran on October 2–4; each result stopped locally with approved_count_file_missing before an HTTP POST.

## Changes

- Preserve the existing Beelink capture, Rescue, video archive, review and durable count-transport work.
- Add explicit partial export from hash-checked review ledgers: count only confirmed physical units, retain pending cases and an unknown full-day total.
- Allow nonzero reviewed partial counts only after the published dashboard's partial display has been verified and dashboardSupportsPartialCounts is explicitly enabled.
- Permit explicit tenant-aware revisions with a predecessor digest, matching configuration and a newer approval timestamp at whole-second precision. Preserve receipt history and prevent complete-to-partial regressions.
- Keep raw tracks, images, POS sales and physical cup evidence separate.

## Validation — October 8

- 38 sender tests and 17 review-validator tests passed locally and on Beelink.
- Real October 4 ledger revalidated against 82 evidence files: 13 confirmed unique physical cups in selected reviewed sequences and two pending cases.
- A labelled partial candidate was staged outside the active outbox. Original ledger and evidence unchanged; no production POST.
- Full crontab, push-log diagnosis and corrected 2026 event date ranges recorded. The prior supplied epochs referred to 2025.
- No live AI, production migration or deployment was performed.

## Remaining rollout

Verify the actual published database, saved October 3–4 closing records and coverage-aware dashboard. Then coordinate this sender rollout with the runtime contract and PR #13 as applicable. Do not enable partial display capability based only on a GitHub merge.

The user's Manus admin access exists; Codex's Opera connector is disconnected. This is a connection limitation, not evidence that the user lacks permission.

Instructions: notes/manus-diagnostico-y-cierre-2026-10-08.txt
Evidence: notes/pipeline-diagnosis-2026-10-08.md
