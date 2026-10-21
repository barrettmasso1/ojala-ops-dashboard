# Ojala: one durable receiver, one application database

Owner: Anhec / Uriel. Prepared 2026-10-21. This document is not evidence of deployment.

## What this change fixes

The existing `frigate.submitHandoffVisual` procedure can opt in to
`receiptMode: "after_storage"`. Its credential resolution, image SHA-256 checks,
capture identity, geometry checks, and store isolation remain in force. It saves
and re-reads the event and attached image before returning a structured receipt.
It does not wait for image classification and never creates a physical cup count.
The default `after_analysis` mode preserves existing callers and admin imports.

Original sourceDetail is retained inside a server-authored envelope. Only records
bearing that opt-in envelope enter the new analysis queue. Existing historical
imports, manager decisions, and ambiguous reviewed cases are not replayed.
The worker scans the existing database with atomic leases, at most five records
per cycle, one analysis at a time, and at most three attempts for an opted-in
record. An expired lease is recoverable after a crash. No in-memory timer is the
source of truth. Geometry mismatches remain for human review.

The client validator `beelink/handoff-visual-sender/persisted_receipt.py` checks
store, event, business date, exact original capture timestamp, image SHA-256,
origin and persisted row ID. Pending AI is distinct from pending transport.
It performs no network or queue writes and does not remove existing holds.

## Two supported deployment choices, without another dashboard

1. Existing Manus application: deploy this tested code, then the zone/platform
   administrator must resolve the actual edge rule for the existing ingestion
   paths. Application-owner access is not Cloudflare-zone administration.
2. Independently owned hosting: deploy `Dockerfile.receiver` from this SAME repo.
   It exposes only the existing machine-ingestion procedures and health check;
   there is no duplicate dashboard, no proxy to manus.space, and no new database.
   Keep the current UI reading the existing application database and storage.

Choice 2 requires an authorized hosting account (Railway connection suggested),
explicitly verified permission/reachability for the existing database and storage
services from that account, and private server configuration. If those services
are platform-internal, this image alone is not sufficient: an authorized storage
or database transition must be designed and verified before any cutover.

## Private receiver configuration

Set `DATABASE_URL`, `BUILT_IN_FORGE_API_URL`, `BUILT_IN_FORGE_API_KEY`, and the
verified existing application configuration through the hosting secret manager,
not chat or GitHub. Never copy production secrets into this repository.
`OJALA_EXPECTED_DATABASE_FINGERPRINT` must be SHA-256 of the verified database URL's
hostname, port (default 3306), and decoded database pathname without leading slash,
joined by newline. Compute it within the authorized runtime; do not guess from a
preview. The receiver refuses startup when this binding or required schema is
unavailable. It never runs migrations. `PORT` is supplied by the host.

Build: `pnpm build:receiver`. Start: `pnpm start:receiver`.
The Docker image is a deployment recipe; it is not proof of a reachable cloud service.
Application API keys still resolve to their managed stores in the existing DB.
No keys are rotated by this change.

## Acceptance and cutover (not yet performed)

- Confirm deployed capabilities report `handoff_persisted_receipt_v1`.
- Confirm sanctioned M2M ingress or the independently owned receiver and TLS.
- Preserve and reconcile existing direct/Manus queues before switching the sender.
- Send one authorized original event, with unchanged ID/time/hash and the new mode.
- Validate the structured receipt, persisted row and actual dashboard entry.
- Replay that exact ID once under controlled testing: same row, no duplicate.
- Test an unavailable receiver, interrupted connection, and recovery without loss.
- Measure capture -> storage -> dashboard times; polling intervals are not latency proof.
- Only then activate one production transport and retain the old route as held fallback.

Current Cloudflare holds and the interrupted administrative-import batch remain
untouched. No new POST to a held path is authorized merely by compiling this code.
The private Manus diagnostic confirmed no zone control and no other preconnected
hosting destination. No new support ticket or external person was contacted.

## Deliberately not claimed

No complete daily physical-cup total, no new live capture-to-cloud acceptance,
no end-to-end delivery latency, no full-shift thermal certification, and no
repair to Cloudflare can be inferred from these unit/integration tests.
The approximately 90% manual agreement remains the user's prior reported result.
