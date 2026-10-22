# Live photographic evidence without offline review latency

Owner: Anhec / Uriel. This is a local bridge improvement, not a cloud-delivery claim.

Incremental collection now packages only original verified image/sidecar pairs,
without opening the video archive, attaching physical counts, or waiting for a
video window to finish. Two seconds of source age plus original sidecar/hash
validation are required. Legacy nightly callers retain their 60-second/video
collection behavior and their unchanged default manifest shape.

The incremental request asks only for persisted visual rows and a strict receipt.
Previously it also requested temporal video review before completion. Existing
immutable batches, identities, hashes, human decisions and transport holds are
not rewritten. Any older incremental package may retain its original clips, but
the receiving task is instructed not to review them for this image-only request.

Validation: 66 focused/regression tests pass, including 11 new photo-only tests.
A real October 22 snapshot was locally validated: one image plus its original
sidecar, 352551 bytes, with unchanged hashes. This local check did not upload it.

The direct Cloudflare path is still held. The alternative private task currently
requires an authorized browser client, and browser.onlineList returned none.
Railway CLI authorization is not established. Neither a new receipt nor a public
cloud deployment is claimed. No photographs, credentials, or private network
configuration are included in this source change.
