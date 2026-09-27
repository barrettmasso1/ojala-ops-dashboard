# Frigate verified handoff visual filter

## Scope

This feature adds a **second, visual evidence filter** for the `handoff` camera. It is separate from the existing Frigate count ingest and is intentionally **not** an operational counter.

- It accepts only image events submitted with an authenticated Frigate machine credential.
- The server resolves the store from that credential; a request never authorizes itself with `storeId`.
- It accepts a required image **and** verified JSON sidecar contract, stores one evidence event per `(storeId, cameraName, cupEventId)`, and preserves the original sidecar identity/timestamp/checksum.
- It uses the established project vision helper to evaluate one still image only after a manager has configured a real normalized `handoff_zone` polygon for that store/camera.
- It labels the image `approved_by_ai`, `discarded`, or `pending_review`. Managers can later set `approved_by_manager` or `discarded_by_manager`.
- It does **not** write `frigateCupCounts`, sales, deliveries, POS totals, inventory, revenue, or staff activity.
- A separate, manager-only recovery path can preserve a frame extracted from an original recording. Such a row is labeled `recording_extracted_frame`, never an automatic Frigate success, and stays pending manager review even if the model finds a person, gelato cup, and configured zone.

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
| `capture.schema_version: 3` | Production capture format for geometry-bound evidence. |
| `capture.zone_geometry` | Capture worker's normalized polygon snapshot; never authorizes a zone by itself. |
| `capture.zone_config_sha256` | SHA-256 of the canonical normalized geometry JSON. It must match both the sidecar and the active server zone. |
| `capture.image_dimensions` | Positive pixel dimensions recorded by the capture worker. |

The response includes a `retryable` boolean. `pending_review` with `retryable: false` is an ambiguous human-review case and must not be sent repeatedly. `retryable: true` means either a retryable analysis outage or an absent store/camera geometry; the sender safely retries the same immutable event ID.

The receiver retains compatibility with validated schema-v2 sidecars during the migration, but **new Beelink captures must emit schema version 3**. A v3 sidecar whose zone hash or polygon differs from the server's active zone is retained for manager review and is never sent to AI as automatically approvable evidence. The immutable sidecar timestamp—not the database timestamp precision—is used to identify a retry, so `+00:00` timestamps with microseconds survive MySQL/MariaDB/TiDB precision differences.

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

## Missed-scene recovery and the 26 September 2026 Ojala case

`handoff-acceptance/ojala-2026-09-26-case.json` separates the supplied facts for the 16:56:52–17:06:52 America/Mazatlan window:

- **Human reference:** operator reported two medium cups. This is not an automatic size classification or a sale created by this feature.
- **Tracks:** one Frigate `cup_event`, `1790467493.946143-9rdbpk`.
- **Automatic capture:** one image/JSON pair at 17:04:57.764 local, with one queued sender record and zero confirmed sends as reported.
- **Other scene:** an apparent cup near 17:02:38 in the recording, without an independent automatic event/capture. Any frame later extracted from that recording is `recording_extracted_frame`, not an automatic capture.

The repository contains an offline-only replay package at `beelink/handoff-scene-recovery/`. It accepts a locally supplied evidence ZIP, extracts an isolated candidate frame, writes checksums and separate measures, makes no network or database request, and does not execute AI. The original evidence ZIP is required before claiming model boxes, model confidence, a visible-cup count, timing, or the root cause of the omission. Raw archives, recordings, and frames are ignored by Git.

The measured proposal is to establish recall only against independently human-reviewed person + gelato-cup + configured-zone scenes, then measure manager-approved candidates and manager-discarded candidates per reviewed minute. Any first-stage detector change needs a separate benchmark/PR and must retain source identity, retry, and deduplication.

## Data and migration

Migration `0015_frigate_handoff_visual_filter.sql` is intentionally **after** the integrated onboarding migration `0014_glossy_silvermane.sql`.

It creates only:

- `frigateCameraZones` with a Store-scoped `handoff_zone` configuration and `ON DELETE RESTRICT` relationship.
- `frigateHandoffVisualEvents` with a Store-scoped event unique key, original capture metadata/checksum, geometry snapshot, lease token, retry state, review metadata, and stored-image reference.

The migration is non-destructive. It neither changes nor backfills `frigateCupCounts`, and it must be executed through the normal Drizzle migration mechanism only after the separately approved Phase 1 sequence. It does not modify `0012`, `0013`, or the integrated onboarding `0014` migration.

Migration `0016_handoff_scene_recovery_evidence.sql` follows `0015` and is also non-destructive. It adds only `evidenceOrigin`, the model's `aiSuggestedStatus`, and a store-origin-time index to visual evidence. It does not backfill, count, create sales, or alter `0012`–`0015`.

## Deployment sequence (not executed by this PR)

1. Confirm the target runtime database administratively and take a fresh recoverable backup.
2. Complete the approved Phase 1 migration/recovery gates; apply `0012` and `0013` to the confirmed target only when authorized.
3. Apply existing onboarding migration `0014_glossy_silvermane.sql`, then `0015_frigate_handoff_visual_filter.sql` and `0016_handoff_scene_recovery_evidence.sql`, through normal Drizzle migration. Do not use `db:push` and do not mark migrations manually.
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
- Recovery-replay tests create a synthetic local video and ZIP only; they prove path isolation and provenance separation, not behavior of the original Ojala recording or a live vision model.
