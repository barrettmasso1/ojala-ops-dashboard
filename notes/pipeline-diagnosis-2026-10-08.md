# Pipeline diagnosis — 2026-10-08

Checked on Beelink ojala-MINI-S at 12:23–12:32 America/Mazatlan.

## Cause, not speculation
- Cron has the 22:00 daily job plus retries at :15/:45 and reboot.
- The first nightly result exists at 22:00:01 on Oct 2, 22:00:02 on Oct 3 and 22:00:02 on Oct 4.
- All three stop locally with approved_count_file_missing and posted:false.
- Approved records and receipts are absent from the actual scripts/approved_counts and scripts/push_state paths.
- Read-only Frigate SQLite: Oct 2 = 34 cup tracks / 34 in zone; Oct 3 = 0 / 0; Oct 4 = 24 / 20. These are tracks, not unique cups.
- Archived Oct 3 audit covers 23.632% of configured 12:00–21:00; first video 18:52:10. It does not establish zero sales.
- Sunday ledger establishes 13 confirmed physical units in selected sequences, 2 pending cases and 82 hash-checked files. Independent manual and POS counts remain unknown.

## Root cause addressed
The previous review exporter required a full-day review before any count file could exist; the sender independently rejected every partial count. This is too restrictive for a pilot that needs clearly labelled partial evidence.

The exporter now has an explicit partial path. The sender permits reviewed nonzero partial evidence after the published dashboard's coverage-aware display is verified. Tenant-aware revisions require explicit predecessor digest, matching configuration and a strictly newer whole-second approval time; receipts retain history. Missing/ambiguous units, tracks and photos are never manufactured into counts.

## Validation
- 38 count sender tests passed locally and on Beelink.
- 17 ledger tests passed locally and on Beelink.
- The actual Sunday ledger and all 82 files revalidated; a partial 13-unit record passes sender schema validation, keeps 2 pending cases, dailyCupCount=null and leaves the original ledger unchanged.
- No real API call, live AI call, active cron/config change or production write was performed by these tests.

## Production and communication correction
The user's Manus admin permissions are not the same as Codex's Opera connection. The connector returned Browser not connected; saying the user lacked administrative access was incorrect.
Current GitHub main is 9b0b9d9e1b940e48a22275037c332fcb034a3446; PR #13 remains open at bb8b0ce96d36b49069b8517c90cd68dcda09308d.
Public-page fetch returned HTTP 403. Production DB binding, migration ledger, published partial rendering and the Sunday saved closing were NOT verified in this run. Do not infer them from GitHub or from zeros on screen.

## Next concrete action
Use notes/manus-diagnostico-y-cierre-2026-10-08.txt in the authenticated Manus project. Verify the saved closing rows and published partial display, then complete the authorized backup/migration/deployment and real-count verification. Friday acceptance testing remains pending until a real record is persisted and displayed; local capture need not stop.
