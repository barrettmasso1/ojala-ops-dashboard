# Ojala local cup engine

Autonomous detection registration using the already installed Frigate/OpenVINO
model. Runtime needs neither ChatGPT nor a Manus agent nor a browser. Source
Frigate data is read-only. Model weights, live configuration and sales are not
modified. A detector track is not a certified physical serving.

## Components

- `collector.py`: polls all current-day cup tracks, including already-ended short
  events, every two seconds; validates original same-frame local cup/person
  sidecars and image hashes; archives immutable evidence on the UUID-guarded
  external disk; writes a WAL/FULL SQLite ledger and durable outbox.
- `ledger.py`: stable source identity, versioned observations, exact-repeat
  idempotency, preserved original provenance, and possible cross-track repetition
  warnings. Simultaneous source IDs remain separate. Warnings do NOT silently
  merge different servings or convert track counts into unique deliveries.
- `native_sync.py`: disabled until the published API passes acceptance. It sends
  a versioned metadata-only snapshot to the authenticated native application API.
  An acknowledgement requires a fresh persisted readback. An uncertain result
  is reconciled, not re-posted blindly. A replay is permitted only after two
  authenticated absence readbacks, a 120-second settling period and within a
  three-attempt limit. HTTP 401/403 cause a durable hold.

## No external AI in this path

The local v4 model has a cup class, not validated capacity classes. Size therefore
remains `unknown`. This path never calls Gemini, OpenAI, ChatGPT, Manus task APIs,
Selenium or Firefox. Existing legacy photo/size tools are separate and are NOT
claimed removed by adding this module. Metadata synchronization does not upload
photo bytes or call image-analysis endpoints. The external archive keeps images
available for future native image storage support.

## Current meaning and limits

One ledger row per source track; repeated polls and process restarts do not add
rows. A cup may get multiple source tracks, and an undetected cup cannot be
recovered by transport. Final unique deliveries remain null until temporal
validation. Manual/POS quantities are never used to fill camera totals. Raw
tracks without same-frame evidence remain explicitly unverified. Native API
snapshots currently cap at 2000 records / 4 MiB and fail explicitly above that
limit. At startup/day rollover, an already-recorded previous day is finalized before
collecting today. Arbitrary historical reconstruction still requires --date.

## Deployment requirements

Configure external stateRoot and expected model SHA-256; mount identity and an
8 GiB free reserve are checked before writes. Use the user's authorized existing
machine credential without printing it. Keep `networkEnabled: false` until the
published localLedgerCapabilities and one genuine persisted receipt are verified.
Do not remove older Cloudflare holds or copy browser sessions to make it work.

The app stores the metadata ledger under its private existing object storage,
scoped by credential-derived store, device, and local date. Compare-and-swap
ETag writes prevent concurrent overwrites. Readback/API scope must succeed in
production; unit tests or a merged PR alone do not prove deployment. The public
media proxy cannot sign or serve the reserved local-cup-ledger namespace.

## Validation

python3 -B -m unittest discover -s .

Tests include concurrent/repeated events, three simultaneous targets, short
ended tracks, midnight conversion, missing proofs, altered hashes, stale
receipts, interrupted dispatch, restarts and credential scoping. Fixtures stay
in temporary local directories and are never uploaded as real observations.
