# Tenant Credential Boundaries

This change set builds on **Phase 1**. It does not alter `0012_multi_tenant_v1.sql`.

## Required migration order

1. Restore and verify an isolated rehearsal copy using the existing recovery procedure.
2. Apply `0012_multi_tenant_v1` through Drizzle to create `stores`, associate historical data with Store 1, and add the scoped Frigate uniqueness constraint.
3. Apply `0013_tenant_credential_boundaries` through Drizzle. It adds `stores.isActive` with a non-destructive default of `1` and creates `storeCredentials`.
4. Verify that Ojala Gelato remains Store 1 and active before configuring credentials.
5. Provision Store 2 credentials server-side by inserting only SHA-256 hashes into `storeCredentials`. Do not store or log a plain password or Frigate key.
6. Validate revocation by setting `revokedAt`; revoked credentials and inactive stores must not resolve.
7. Run the two-store authentication, read/write isolation, and Frigate event tests against the isolated database before any production execution.

## Server resolution rules

The client sends only a password or API key. It never sends an authorized `storeId`:

- `auth.staffPortalLogin` first resolves an active `staff_portal` credential by hash, then creates a session for that resolved store.
- `frigate.submitCounts` first resolves an active `frigate` credential by hash, then writes to that resolved store.
- The legacy `STAFF_PORTAL_PASSWORD` and `FRIGATE_API_KEY` remain explicit compatibility paths **only** for active Store 1. They cannot select Store 2.
- OAuth users must be provisioned server-side with an existing, active `users.storeId`. First-time OAuth sign-in no longer implicitly creates a Store 1 user.

## Frigate retry contract

A Frigate payload represents the current **absolute** count for one `(storeId, businessDate, cameraName)` tuple. The database unique index and `ON DUPLICATE KEY UPDATE` make a retry idempotent: it updates the same tuple instead of duplicating it or deleting then reinserting it.

## Scope and remaining certification work

This branch intentionally retains one store per user. It does not add a memberships table or Store 2 UI onboarding. The regression tests use mocked router/database boundaries and must not be represented as TiDB integration tests. Phase 1 remains uncertified until an isolated TiDB restore/migration rehearsal, published-runtime database provenance, real two-store authentication/isolation, and real Frigate ingestion have all been completed.
