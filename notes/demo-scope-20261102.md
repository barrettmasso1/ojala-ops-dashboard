# Ojala 2 November demo evidence and limits

These are local-agent observability and read-only preflight tools, not a certified
sales counter. The passive source receives existing detector metadata; it never
runs inference, changes the camera or publishes detections. Every non-empty
source packet is retained, with explicit dropped-packet markers. Empty packets
are sampled at 1 second and the omitted count is visible. The local queue is
bounded to 32 MiB inside the existing 256 MiB emergency allocation, retaining an
8 GiB free-space reserve. No source evidence is deleted.

Preflight independently reads native receipts for a selected business date and
reports raw observations separately from delivery counts and unavailable manual/
Shopify sources. It does not create those records or open a browser. Configuration
and credentials are not included. Temporary storage is not SSD repair.

Validation: 21 metadata protocol tests, 21 inherited guard regression tests and
9 preflight tests passed on isolated fixtures. The actual recorder was observed
receiving real frames; 134 preexisting receipt rows and upload-attempt values were
unchanged. No physical delivery count or paid sale was certified by these tests.

A safe video replay was held by the temperature/load guard. An attempted private
video transfer was blocked by the tool and was not retried or rerouted. No new
video-based classifications or counts were asserted from that attempt.
