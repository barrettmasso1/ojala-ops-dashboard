# Per-cup descriptions for camera evidence and manual closing records

Owner request: Anhec wants chico, mediano, pint and litro descriptions for camera images and his manually entered cups.

- Shared canonical labels: Chico (4 oz), Mediano (8 oz), Pint, Litro, Sin clasificar.
- Manual closing quantities and here/to-go field names, nominal ounces, sales, inventory and stored values are unchanged. Existing sizes are displayed with requested labels; absent closing stays pending.
- Camera images list separate cup observations in left-to-right order, up to eight, each with size and optional detail. They are not unique daily deliveries or sales.
- Authenticated managers can save descriptors without approving/discarding the image. The server binds store and actor to the signed-in session and requires a revision token. Compare-and-swap plus readback rejects stale writes.
- Persistence uses an explicitly versioned envelope in the existing manager reviewNotes field, retaining the original free-text notes. Every read decodes it; normal approval/discard preserves the descriptions. Malformed or conflicting envelopes fail closed. Reserved envelope prefixes cannot be injected through the plain note interface. No schema change, migration, backfill, production fixture, or historical AI rerun is required.
- New AI results may suggest size only from high-confidence legible printed capacity. Pixel area, angle, color, apparent fill, or unsupported capacity guesses are not accepted. Unknown remains unknown. Manual labels override suggestions. Existing evidence is not reclassified automatically.
- AI receipt/status decisions and the live photographic relay remain separate and unchanged; no image or description supplies cupsDetected.

Deployment: apply these app changes to the existing Ojala website and preserve its auth, database, storage, production data and visibility. Do not run db:push, migrate, or seed. No new dashboard or Railway service is needed for this feature.

Acceptance: requested labels on manual form and dashboard; per-image descriptive controls; authenticated persistence with reload; negative tenancy and stale-edit tests; live photo relay remains active. Production labels may correctly remain Sin clasificar until evidence or manager input supports a size.
