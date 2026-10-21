# Offline review: candidate search is not a daily cup count

This change does not modify Frigate configuration, camera geometry, production model weights,
production thresholds, approved_counts, cloud credentials, or transport holds.

## Fixed failure mode

The previous offline scanner rejected all candidate boxes outside the original handoff polygon.
That reused a production gate in a recovery search meant to find production omissions. The
scanner now supports explicit `--search-area full_frame` while retaining area/finite-coordinate
validation, original-coordinate boxes and an `inHandoffZone` marker. Standalone legacy callers
default to the old zone mode. The post-close recovery wrapper explicitly selects full-frame
search. Full-frame SEARCH still samples prioritized windows; it is not continuous video review.

A bounded real-image probe demonstrated why this is not an accuracy claim: some images with
visible servings still yielded no retained model candidates. Training/generalization, object
scale, area filtering and occlusion remain distinct possible causes. No event or count is
manufactured from an empty model result.

## Thermal and execution protection

The wrapper limits its own Docker scanner to 0.25 CPU and monitors temperature and Frigate's
running state every two seconds. It stops only its own named container if temperature reaches
83 C, camera state becomes unavailable/active, or the bounded runtime is exceeded. Partial
review output is retained. This is workload protection, not a physical fan repair.

The existing UUID-bound external-storage checks and 8 GiB reserve remain. Scope-specific
output directories include the snapshot, audit, model, configuration, scanner and helper
fingerprints so an old zone-only cache cannot stand in for a new full-frame run. Original
archive segments and earlier review outputs are never deleted.

## Review-ledger validator

`beelink/count-review/validate_scene_review.py` validates a LOCAL review ledger against its
referenced original ledgers. It rejects repeated identities, reused evidence disguised as a
new unit, invalid dates, unknown references, missing temporal context, arithmetic inflation,
manager-approval claims, and full-day certification claims. Non-cup, ambiguous and return
observations cannot add units. Validation does not replace visual review or certify accuracy.

Reusable vessels must be reviewed by serving lifecycle. Merely seeing the same vessel again
is not a new serving; neither should a genuinely new filled serving later in the same glass
be removed solely because the glass is reusable.

## Validation performed

- 21 focused search-region/thermal-safety tests passed.
- 18 new review-ledger tests passed, plus 17 existing count-review tests.
- A guarded offline probe decoded and processed four actual archived frames with the unchanged
  v4 model. It was not a full-shift accuracy benchmark or a production cloud acceptance test.
- The normal wrapper invocation on a non-operating day skipped without starting Frigate.

No migration, cloud deployment, live-camera count, full-day total, new manual comparison,
or Cloudflare recovery is implied by this source change.
