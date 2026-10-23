# Authorized Firefox administrative photo relay

This is an operational bridge to the EXISTING published Ojala administrative
importer. It is not the blocked direct Frigate endpoint, a Cloudflare exception,
a Railway deployment, or a new independent dashboard. It uses the owner's actual
Firefox session and checks admin role + Store 1 before every protected import.
No browser cookies, passwords, API keys or sessions are exported by the worker.

## Scope and safety

Only completed schema-3 verified-snapshot image/sidecar pairs for the current
America/Mazatlan business day are selected. The existing audited exporter checks
source bytes, identity, geometry and normalization provenance. Videos are not
uploaded and no physical cup counts, sales or inventory writes are made.

The external UUID-bound disk and 8 GiB reserve are checked. Per-event ZIPs,
receipts, queue, logs and temporary output remain external. Event IDs are immutable.
Before each write the existing published row is queried; an uncertain POST is held
for readback, not blindly repeated. At 200 query rows, an absent ID fails closed
rather than assuming the limited listing was complete. Positive acknowledgements
require matching database row, image reference, original capture timestamp,
metadata, image hash and store/date/camera/origin. Receipt hashes are server metadata
readbacks, NOT a claim that object-store image bytes were downloaded. Native page
rendering is independently verified when documenting acceptance.

## Dependency

A running authenticated Firefox session with local-only Marionette/geckodriver is
required. The HTTP control service must listen only on 127.0.0.1. If the browser is
closed, session expires or control ID changes, preserve the queue and repair the
session; do not extract credentials, elevate roles, or replace the user account.
A normal reboot does not automatically establish a new browser control session.
The service may restart, but this is not a headless M2M reliability guarantee.

## Invocation

`python3 browser_visual_relay.py --config /private/config.json --daemon`

Config fields: schemaVersion=1, basePath, stateRoot (UUID-bound external root),
browserSessionPath (private WebDriver session descriptor), origin (exact published
origin), storeId=1, timezone=America/Mazatlan, pollSeconds=5,
maxEventsPerCycle=5, enabled=true. No secret fixture/config is committed.

Use one sending route only: back up and pause previous overlapping visual senders
before enabling the service. Keep source capture, archival and independent review
jobs intact. Existing direct holds remain. Reconcile historical batches by actual
persisted identity/hash, without fabricating Manus task receipts.

## Validation

20 focused receipt/boundary tests pass. A real Oct 22 four-image backlog was
persisted in the existing published dashboard and all images loaded in native
Firefox. A fifth NEW original event was automatically stored 6.750 seconds after
capture and its post-analysis readback verified at 42.977 seconds. These are one
event's observed timings, not a latency SLA or a physical-cup accuracy benchmark.
No daily camera total was created.
