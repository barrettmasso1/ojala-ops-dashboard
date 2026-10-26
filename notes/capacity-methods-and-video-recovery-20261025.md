# Capacity investigation and bounded video recovery

The production classifier remains unchanged. A frozen OpenCV Zoo MobileNetV2
feature extractor was evaluated with actual owner-labeled reference crops and
scene-excluded comparisons, without manufacturing labels. It confused known
capacities; it was not deployed. Pixel geometry restoration was also tested and
not promoted, because it did not resolve the unknown examples. These experiments
are calibration diagnostics, not independent commercial accuracy measurements.

Video bugs found: repeated random seeks for every 200 ms sample could exhaust the
worker timeout under its CPU quota. Also, a future overlapping range could reject
a usable earlier source prefix before any sample was read. The patch reads
sequentially after the initial seek, retains exact original timestamps/ranges,
and stops at a disallowed range discontinuity. It does not interpolate gaps,
alter the overlap or thermal guard, or claim complete-day coverage.

73 isolated optical tests pass (18 new reader/prefix tests). Retried only blocked
jobs without an uploaded record after SQLite backups, preserving original attempt
counts and source identities. Successful immutable records were not rewritten.
Primary detector, capacities, owner labels, camera, POS and closures are untouched.
