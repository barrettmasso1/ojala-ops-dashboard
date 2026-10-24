# Local capacity classification (calibration required)

Uses only Pillow, the standard library and owner-confirmed images. It does not
call an LLM, a cloud classifier, a browser, a GPU or the production Frigate model.
HOG-like orientation histograms, color and same-view shape/scale comparisons are
used for conservative reference matching. Distances are not probabilities.

No label is manufactured from sorted pixel sizes, POS totals, old AI estimates,
manual sales counts or filenames. Capacity cannot be learned from the one-class
cup detector without confirmed examples of the actual containers.

`calibration.py` builds a reference page from preserved target crops. An owner
labels only examples whose true nominal capacity is known, including non-serving
objects. Export Ojala_tamanos_confirmados.json to Downloads. No new page/window is
opened automatically. The worker verifies the manifest and original images,
checks at least three separate two-minute scene groups per supported category,
requires contrasting reference classes, and uses leave-one-scene-out checks.
Training failures or indistinguishable classes remain calibration_required.
This small calibration set does not certify commercial/generalized accuracy.

A ready model can be consumed by the collector after the server advertises
sizeClassificationProtocol=ojala_reference_sizes_v1. Source observations retain
original identities and image hashes. Results are explicitly local estimates;
physicalDeliveryConfirmed remains false and POS/manual counts are untouched.
Missing model, new view, conflicting classes, occlusion or an unfamiliar object
remain unknown. Deleting the reference download does not delete the saved model.
Every model revision is retained under state/models.

The real initial run had 23 preserved candidate images and ZERO confirmed labels.
No production class assignment or real size-accuracy measurement was claimed.

## Owner review and selective activation

Exact annotations are stored as owner-confirmed references, not predictions.
Rejected non-cups stay in history but leave capacity summaries. A class may be
activated only with three correctly accepted held-out scenes and no incorrect
confident assignments, preserving original distance/margin limits. Unknown cases
remain unknown. Small-set calibration does not certify generalization.
