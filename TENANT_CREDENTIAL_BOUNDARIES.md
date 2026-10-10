# Tenant Credential Boundaries

This change set builds on **Phase 1**. It does not alter `0012_multi_tenant_v1.sql`.

## Required migration order

1. Restore and verify an isolated rehearsal copy using the existing recovery procedure.
2. Apply `0012_multi_tenant_v1` through Drizzle to create `stores`, associate historical data with Store 1, and add the scoped Frigate uniqueness constraint.
3. Apply `0013_tenant_credential_and_frigate_event_boundaries` through Drizzle. It adds `stores.isActive`, `storeCredentials`, and Frigate source-event ordering fields without deleting business records.
4. Verify that Ojala Gelato remains Store 1 and active before configuring credentials.
5. Provision Store 2 credentials server-side. The provisioning channel must show a plaintext generated machine key only once, then persist only its verifier.
6. Validate revocation by setting `revokedAt`; revoked credentials and inactive stores must not resolve.
7. Run the two-store authentication, read/write isolation, and Frigate event tests against the isolated database before any production execution.

## Server resolution rules

The client sends only a password or API key. It never sends an authorized `storeId`:

- `auth.staffPortalLogin` first resolves an active `staff_portal` credential, then creates a session for that resolved store.
- `frigate.submitCounts` first resolves an active `frigate` credential, then writes to that resolved store.
- The legacy `STAFF_PORTAL_PASSWORD` and `FRIGATE_API_KEY` remain explicit compatibility paths **only** for active Store 1. They cannot select Store 2.
- OAuth users must be provisioned server-side with an existing, active `users.storeId`. First-time OAuth sign-in no longer implicitly creates a Store 1 user.

### OAuth account provisioning

The trusted administrator continuity check uses the exact `OWNER_OPEN_ID` configured in the existing runtime, not email matching. The current read-only check found exactly one user matching that identifier and that user has the `admin` role; no user record was modified. After 0012, the historical user receives Store 1 through the non-destructive migration, so the active-user check continues to allow the same OAuth identity.

To provision a new account, an existing Store 1 administrator must use a server-side administrative workflow that: (1) verifies the identity through the platform OAuth record, (2) selects an existing active store in a privileged server-side action, (3) creates or updates the user with that fixed `storeId` and an explicitly chosen role, and (4) records an audit entry. The browser must never provide the authorized store or role; no self-registration path can assign a tenant or elevate a role.

## Credential storage and throttling

| Credential use | Verifier | Provisioning rule |
|---|---|---|
| Human staff portal password | Salted, costed `scrypt` (`N=16384`, `r=8`, `p=1`, 16-byte random salt) | Minimum 12 characters; persist only the scrypt verifier |
| Frigate machine API key | 256-bit random key, persisted as a SHA-256 lookup hash | Generate with 32 random bytes; show plaintext once and never log it |
| Legacy environment secret | Environment-only compatibility check | Store 1 only; not represented by a revocable database row |

Credential failures are rate-limited in memory per client address and channel: five failures within 15 minutes block that channel/client pair for 15 minutes. The limiter stores neither a submitted password nor an API key. This is an application-level first control; production should additionally apply edge/IP rate limits before exposing any public ingestion URL.

### Legacy secret retirement

Revoking a `storeCredentials` row does **not** revoke `STAFF_PORTAL_PASSWORD` or `FRIGATE_API_KEY`, because those environment secrets continue to work through their explicit Store 1 compatibility routes. To retire a legacy secret, first provision and validate an equivalent managed credential for Store 1, then remove or rotate the corresponding environment variable and redeploy. Only after the environment variable is absent does the legacy path stop accepting it.

## Frigate retry and ordering contract

A Frigate payload represents the current **absolute** count for one `(storeId, businessDate, cameraName)` tuple, not an increment. Every payload must include:

```json
{
  "sourceEventId": "unique-snapshot-id",
  "sourceEventAt": "2026-09-22T19:01:00.000Z"
}
```

`sourceEventAt` is a UTC ISO timestamp ending in `Z`. An exact retry reuses both values. The database compares source event time, not count magnitude: a later correction can legitimately lower the cup count and is applied; an older event is ignored. `ON DUPLICATE KEY UPDATE` repeats the ordering predicate atomically, preventing a concurrent old retry from winning after the application’s preliminary check. Historical rows receive `legacy-<id>` and their prior `receivedAt` during 0013.

## Scope and remaining certification work

This branch intentionally retains one store per user. It does not add a memberships table or Store 2 UI onboarding. Router tests use mocked boundaries and must not be represented as TiDB integration tests. The Docker rehearsal package contains the real local-TiDB fixtures but has not been run in Manus because Docker is unavailable here.

Phase 1 remains uncertified until an isolated TiDB restore/migration rehearsal, published-runtime database provenance, real two-store authentication/isolation, and real Frigate ingestion have all been completed.
