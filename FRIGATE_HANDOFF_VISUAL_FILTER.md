# Frigate verified handoff visual filter

## Scope

This feature adds a **second, visual evidence filter** for the `handoff` camera. It is separate from the existing Frigate count ingest and is intentionally **not** an operational counter.

- It accepts only image events submitted with an authenticated Frigate machine credential.
- The server resolves the store from that credential; the request contains no authorized `storeId`.
- It stores an image event once per `(storeId, cameraName, cupEventId)`.
- It uses the established project vision helper to evaluate one still image for a person, a gelato cup, the handoff zone, and visible cup quantity.
- It labels the image `approved_by_ai`, `discarded`, or `pending_review`. Managers can later set `approved_by_manager` or `discarded_by_manager`.
- It does **not** write `frigateCupCounts`, sales, deliveries, POS totals, inventory, revenue, or staff activity.

## Source restriction

The included Beelink sender has a hard-coded source root:

```text
/home/ojala/frigate/config/verified_snapshots/handoff/
```

It rejects a symlink/path outside that directory, non-image files, and images above 8 MB. It does not read or display legacy automatic snapshot locations, tracks, or clips.

## API contract

`tRPC` procedure: `frigate.submitHandoffVisual`

Required input fields:

| Field | Meaning |
|---|---|
| `apiKey` | Frigate machine key; server resolves the active store. |
| `businessDate` | `YYYY-MM-DD`, derived by the sender in `America/Mazatlan`. |
| `cameraName` | Must be literal `handoff`. |
| `cupEventId` | Stable event identifier; used for scoped deduplication. |
| `capturedAt` | ISO-8601 timestamp. |
| `imageDataUrl` | JPEG, PNG, or WebP image, up to 8 MB. |
| `sourceDetail` | Optional short informational source label; not authorization. |

The response includes a `retryable` boolean. `pending_review` with `retryable: false` is an ambiguous human-review case and must not be sent repeatedly. `retryable: true` means the model/service was temporarily unavailable and the sender should retry the same event.

## Data and migration

Migration `0014_frigate_handoff_visual_filter.sql` creates `frigateHandoffVisualEvents` only. It adds:

- Store-scoped foreign key with `ON DELETE RESTRICT`.
- Scoped unique key for `(storeId, cameraName, cupEventId)`.
- Queue/lease timestamps for safe retry and recovery after a process interruption.
- Manager decision metadata and stored-image reference.

The migration is non-destructive. It neither changes nor backfills `frigateCupCounts`; it must be executed **after** the reviewed Phase 1 migration (0012) and tenant credential migration (0013), and only in the separately approved coordinated deployment procedure.

## Deployment sequence (not executed by this PR)

1. Confirm the target runtime database administratively and take a fresh recoverable backup.
2. Complete the isolated rehearsal and approval gates for 0012/0013; apply those migrations to the confirmed target only when authorized.
3. Apply 0014 through the normal Drizzle migration mechanism. Do not use `db:push` and do not mark migrations manually.
4. Deploy the application version that contains the new receiver and manager review route.
5. Update the existing Frigate **count** sender to include `sourceEventId` and `sourceEventAt` before activating this new image sender.
6. Provision or confirm the server-bound Store 1 Frigate machine credential without logging it, then install the Beelink sender package and run a deliberately selected verified image event.
7. Verify one stored image appears in **Handoff Review** and that neither the camera cup-count tile nor sales/inventory data changed.

## Validation coverage

- Router tests use mocked storage, database, and vision responses. They prove credential-derived tenant resolution, payload `storeId` rejection, manager-store scoping, deduplication call shape, and non-mutation of Frigate counts.
- Classifier tests use mocked structured vision outputs for a known positive, a lamp/arm false positive, and an ambiguous case. They are not a live model benchmark.
- Sender tests use temporary files and a temporary SQLite database. They prove verified-root enforcement, sender-side deduplication, terminal delivery, retryability, and no payload `storeId`.
- No live AI call, real Beelink image, active database migration, merge, deployment, or production endpoint call was performed for this PR.
