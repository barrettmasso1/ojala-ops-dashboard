# Phase 1 deploy checklist

1. Save pre-migration row counts with `drizzle/0012_multi_tenant_v1_preflight.sql`.
2. Review `drizzle/0012_multi_tenant_v1.sql` line-by-line before merge.
3. Confirm production backup/snapshot exists for the database.
4. Merge PR #1 only after approval; do not cherry-pick partial migration changes.
5. Deploy the merged `main` build through Manus.
6. Run `drizzle/0012_multi_tenant_v1_verify.sql` after migration.
7. Confirm historical Ojala records remain visible under `storeId=1`.
8. Verify manager and staff login flows still work.
9. Verify Frigate count ingestion continues to write to store 1.
10. Verify a test store 2 session cannot read Ojala/store 1 data.
11. Check opening, closing, EOD, inventory, gelato, attendance, recipes, and submission history.
12. Roll back immediately if row counts differ unexpectedly or historical data is missing.

Phase 2/3 remain out of scope until this checklist passes in production.
