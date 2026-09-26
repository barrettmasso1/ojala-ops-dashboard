# Frigate verified handoff visual filter

## Scope

This feature adds a **second, visual evidence filter** for the `handoff` camera. It is separate from the existing Frigate count ingest and is intentionally **not** an operational counter.

- It accepts only image events submitted with an authenticated Frigate machine credential.
- The server resolves the store from that credential; a request never authorizes itself with `storeId`.
- It accepts a required image **and** verified JSON sidecar contract, stores one evidence event per `(storeId, cameraName, cupEventId)`, and preserves the original sidecar identity/timestamp/checksum.
- It uses the established project vision helper to evaluate one still image only after a manager has configured a real normalized `handoff_zone` polygon for that store/camera.
- It labels the image `approved_by_ai`, `discarded`, or `pending_review`. Managers can later set `approved_by_manager` or `discarded_by_manager`.
- It does **not** write `frigateCupCounts`, sales, deliveries, POS totals, inventory, revenue, or staff activity.

## Source restriction

The included Beelink sender has a hard-coded source root:

```text
/home/ojala/frigate/config/verified_snapshots/handoff/
```

It rejects a symlink/path outside that directory, non-image files, corrupt image signatures, images above 8 MB, missing JSON sidecars, malformed sidecars, and checksums that do not match image bytes. It does not read or display legacy automatic snapshot locations, tracks, or clips.

## Capture pair contract

`tRPC` procedure: `frigate.submitHandoffVisual`

| Input | Purpose |
|---|---|
| `apiKey` | Frigate machine key; the server resolves the active store. |
| `imageDataUrl` | JPEG, PNG, or WebP image, up to 8 MB, validated against its declared image signature. |
| `capture.camera` | Must be `handoff`. |
| `capture.cup_zone` | Must be `handoff_zone`; it is checked against a server-configured geometry, not trusted as geometry by itself. |
| `capture.cup_event_id` | Stable source event identifier used for scoped deduplication. |
| `capture.captured_at_utc` | Original UTC ISO-8601 capture time; server derives the business date from this time and the authenticated store time zone. |
| `capture.image_sha256` | Lowercase checksum of the exact image bytes; server recomputes and compares it before storing. |

The response includes a `retryable` boolean. `pending_review` with `retryable: false` is an ambiguous human-review case and must not be sent repeatedly. `retryable: true` means either a retryable analysis outage or an absent store/camera geometry; the sender safely retries the same immutable event ID.

## Real handoff geometry

`cameraName: "handoff"` is not a zone definition. Store settings adds a manager-only **Handoff camera zone** control. The manager records a normalized polygon using `x, y` coordinates from a current handoff image, where `(0,0)` is top-left and `(1,1)` is bottom-right.

- The saved polygon is versioned by `(storeId, cameraName, zoneName)`.
- The active geometry snapshot/version is stored on each visual evidence record before analysis.
- If no geometry exists, the verified image is retained in the queue as pending and is not automatically approved.
- Updating a zone affects future unbound pending events; it does not silently reinterpret completed evidence.

## Queue and review safety

- The server creates a durable event before image storage or vision processing.
- A scoped unique key makes a sender retry idempotent.
- A five-minute lease has a random lease token. Only the holder of that token can finalize or defer the active `pending_review` analysis.
- A manager decision clears the lease/token and retry schedule. A late vision response can therefore neither overwrite the manager decision nor cancel a newer retry.
- A 45-second model timeout defers the event with bounded exponential retry. A later underlying model response is harmless because the token no longer matches.
- No status transition increments deliveries, cup counts, sales, inventory, or revenue.

## Data and migration

Migration `0015_frigate_handoff_visual_filter.sql` is intentionally **after** the integrated onboarding migration `0014_glossy_silvermane.sql`.

It creates only:

- `frigateCameraZones` with a Store-scoped `handoff_zone` configuration and `ON DELETE RESTRICT` relationship.
- `frigateHandoffVisualEvents` with a Store-scoped event unique key, original capture metadata/checksum, geometry snapshot, lease token, retry state, review metadata, and stored-image reference.

The migration is non-destructive. It neither changes nor backfills `frigateCupCounts`, and it must be executed through the normal Drizzle migration mechanism only after the separately approved Phase 1 sequence. It does not modify `0012`, `0013`, or the integrated onboarding `0014` migration.

## Deployment sequence (not executed by this PR)

1. Confirm the target runtime database administratively and take a fresh recoverable backup.
2. Complete the approved Phase 1 migration/recovery gates; apply `0012` and `0013` to the confirmed target only when authorized.
3. Apply existing onboarding migration `0014_glossy_silvermane.sql`, then `0015_frigate_handoff_visual_filter.sql`, through normal Drizzle migration. Do not use `db:push` and do not mark migrations manually.
4. Deploy the application version containing the receiver, Handoff Review route, and Store settings zone configuration.
5. Update the existing Frigate **count** sender to include `sourceEventId` and `sourceEventAt` before activating the visual sender.
6. Provision/confirm a server-bound Store 1 Frigate machine credential without logging it. Configure the real Store 1 handoff polygon from a current camera frame.
7. Run the local-only real-image staging script on manually selected verified image+JSON pairs; review its manifest. No live endpoint is called by that stage.
8. Install the Beelink sender and make one controlled visual submission. Verify one evidence item appears in **Handoff Review** and that the camera count tile, sales, inventory, and revenue do not change.

## Validation coverage

- Router tests use mocked storage, database, vision responses, and a mock Store geometry record. They prove credential-derived tenant resolution, required image+JSON fields, checksum rejection, missing-zone queueing, manager-store scoping, and non-mutation of Frigate counts.
- Classifier tests use mocked structured vision outputs for a known positive, a lamp/arm false positive, ambiguity, payload corruption, and timeout behavior. They are not a live model benchmark.
- Concurrency tests assert the code-level lease-recovery, lease-token, human-review, and late-result guards. They use source-level checks, not a live TiDB race.
- Sender tests use temporary image+JSON pairs and a temporary SQLite queue. They prove verified-root enforcement, required sidecar waiting, pair checksum validation, durable retry, terminal delivery, and no payload `storeId`.
- The real-image staging script is **prepared but not run**. No live AI call, real Beelink image, active database migration, merge, deployment, or production endpoint call was performed by this PR.
