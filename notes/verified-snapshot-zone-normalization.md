# Audited verified-snapshot zone normalization

The 2026-10-16 administrative import converted the Beelink zone object into the
server's normalized point list while retaining the original object fingerprint.
The points agree, but these are different byte representations:

- Worker object: `3f9c98b00a0fc36f1a3009fcaf3340910ff157f774d7531e6ac4353a12bce0e1`
- Server point list: `0c5239aac1c6d946af3a6f07319c91afcb1565acf58cb0433e18680c86e8d772`

The configured zone and the original files must not be changed to fix this.

## Export and re-import

After publishing this change, use the original ZIP already attached to the Ojala
task. Its SHA-256 is `63e3696f958f359ead410f81db8c2ab5d132e36c4efd4617410b7b0da49c2ee9`.

```
python3 beelink/handoff-visual-sender/export_verified_snapshot_import.py \
  /path/to/OJALA_EVIDENCIA_16OCT_1743.zip /private/verified-snapshot-import.json
```

The exporter checks the manifest, images, original zone hashes, sidecar bytes,
capture identity and dates. The resulting import file contains the correct wire
fingerprint and an explicit `normalizationProof`, including the original source
bytes and hash. It contains private camera images; do not commit it or paste it
into a chat. Use the authenticated dashboard's original-snapshot import control
with business date 2026-10-16, or that same authenticated administrative procedure.

The four original IDs remain unchanged. Existing production row IDs were reported
by Manus as 360001–360004. The server preserves prior metadata in
`normalization_audit.previousCaptureMetadataJson`; the source sidecar stays intact
in that audit as well. A scoped compare-and-swap changes only a pending verified
capture's metadata and retry time when its old hash is exactly the proved source
hash and all other identity/geometry fields agree. An active analysis lease or
concurrent review blocks the correction. Manager-reviewed rows remain unchanged.

Re-analysis still must pass the separately configured server zone and the visual
filter. Normalization is not visual approval and does not create a camera count,
sale, delivery or inventory movement. The automatic Frigate 403 hold is unrelated
and is not touched. No migrations.

Acceptance after authenticated import: same four row IDs and original event IDs;
original/source/normalized metadata available in the audit; no duplicate visual
rows; actual analysis states read back; no camera-count row created by this flow.
If a row's stored timestamp/geometry/hash differs for another reason, stop and
report that mismatch rather than editing evidence until it passes.
