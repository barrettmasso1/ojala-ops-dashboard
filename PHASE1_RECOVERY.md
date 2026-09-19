# Phase 1 recovery before Phase 2

## Findings before the repair, 2026-09-19

- Production branch `main` at `f6b78b6` includes the OAuth schema rollback (`33b53dd`) and latest-populated-date UI change (`32e973b`). A repository commit does not establish which build is currently deployed.
- `multi-tenant-v1` retains the proposed tenant migration and application isolation changes.
- `drizzle/0012_multi_tenant_v1.sql` is absent from `drizzle/meta/_journal.json`. The checked-in journal therefore does not schedule that SQL file with Drizzle's migrator.
- The migration groups multiple SQL statements within a single statement breakpoint. Do not assume the production driver executes that file correctly.
- The migration is not safe to rerun blindly after partial completion: existing columns, indexes, and constraints can fail, and its seed overwrites Ojala's name/timezone.
- The old verification checks NULL assignments only; that cannot certify preserved history, schema completeness, or authorization isolation.

These are code findings, not a verified explanation of the July/August data gap. The production database has not been queried from this workspace.

## Repair prepared on multi-tenant-v1

- Registered 0012 in the Drizzle journal with a generated schema snapshot.
- Split the SQL into one statement per driver execution.
- Preserved an existing store 1 name/timezone instead of overwriting it.
- Declared the tenant indexes in the schema and snapshot.
- Reconciled the latest manager-login, populated-date, and business-metrics changes from main.
- Added migration-loader and metadata regression tests.
- These changes have not been applied to production. A partially migrated database still requires the read-only audit and an exact recovery plan before execution.

## Read-only evidence

Run in the existing authorized application environment with its existing `DATABASE_URL`; never copy credentials into chat:

```sh
node scripts/audit-phase1.mjs --from 2026-07-01 --to 2026-09-19 --output phase1-audit-20260919.json
```

The script requires the project's existing `mysql2` dependency. It enforces a read-only transaction, uses only fixed table identifiers, and reports aggregate counts, schema state, tenant assignments, and per-day coverage. It does not print credentials, staff names, owner emails, or individual operational records. Exit codes: 0 = no detected schema blockers, 2 = schema blockers, 1 = audit failed. Neither 0 nor a complete schema certifies Phase 1.

Use the daily coverage to find the last populated date in each section. Compare the original database/backup and production using the same date range. Records present in SQL but absent in the authenticated UI point toward application filtering or the deployed environment; absent records require source/ingestion or backup investigation. Do not infer deletion from an empty dashboard alone.

## Recovery sequence

1. Inspect the audit and the database migration ledger in the authorized deployment environment. Identify the exact applied and missing statements.
2. Verify a recoverable database backup and retain aggregate before counts.
3. Generate a recovery migration for the observed schema, preserving existing store configuration and tenant assignments. Do not reapply the original migration or run `db:push` blindly.
4. Keep the current login-compatible production code until the schema is ready. Reconcile the candidate code with recent `main` UI/login fixes in a review branch; do not replace production with the old tenant branch wholesale.
5. Review the exact migration before merge, as requested. Rehearse on a restored database with the same partial schema; register matching Drizzle metadata and use one executable statement per breakpoint.
6. Apply the approved migration, compare row counts and historical coverage, then deploy compatible application code through Manus.
7. Validate manager/staff login, store-2 isolation across reads and writes, and Frigate ingestion. Check both successful responses and denials without changing real users' roles.

## Phase 2 scope after Phase 1 passes

Implement store onboarding with timezone, opening/closing hours, cup sizes, POS type, automatic store-scoped API key issuance, and a simple owner panel. Use tenant membership from the authenticated session; never accept a client-selected store as authorization. Store API-key hashes and show the newly generated key only once. POS type is configuration, not a new POS integration.

Do not enable onboarding while tenant isolation and historical-data preservation remain unverified. The user authorized Phase 2, while the agreed prerequisite is still Phase 1 completion.
