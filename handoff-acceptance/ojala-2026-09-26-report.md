# Ojala handoff scene — 26 September 2026

**Window:** 16:56:52–17:06:52, `America/Mazatlan`
**Author:** Manus AI
**Scope:** Private evidence replay, isolated visual evaluation, and local-only persistence rehearsal. No production application, database, Frigate configuration, or customer media repository was changed.

## Conclusion

The evidence confirms a **separate recording scene at approximately 17:02:38** that did not produce its own Frigate `cup_event` or automatic JPEG/JSON capture. A private Gemini 3.1 Pro evaluation found a person, a gelato cup, and the configured handoff zone in that recovered frame. This is a **review candidate**, not a sale, delivery, or automatic Frigate success.

The automatic 17:04:57 capture is a different item of evidence. Gemini found four visible cups in that still image, while Frigate produced one cup track for the whole ten-minute window. Neither result can be turned into two sales or two deliveries. The operator’s report of two medium cups remains a **human reference**; cup size was not automatically classified or validated.

The supplied audit shows the camera and worker were active, with 5.1 camera frames per second, 5.0 process frames per second, no skipped frames in that sample, and 597.802 seconds of indexed video across 61 segments. It does **not** include a first-detector trace or rejected bounding box for the 17:02:38 scene. Therefore the cause of the missed event is **unconfirmed**. The missing event is observable; attributing it to a detector threshold, zone rule, occlusion, or processing failure would not be supported by this evidence.

## Evidence integrity and replay

The private ZIP matched SHA-256 `ecd1783b153c514813a706f88b2b7866f301032b2b1426f2793f5d3fedaee239`. The preserved replay source recording matched SHA-256 `7f73aa3481abe959f8ff0af6ed2be28867a1d0704e366aa546bd60eda3104b85`. The offline replay completed with exit code 0. Source images and video remain private. They were not committed or uploaded to GitHub.

| Evidence item | Time and origin | Observed result | What it does **not** mean |
|---|---|---|---|
| Operator reference | Window total | 2 medium cups reported sold | The system did not validate medium size or derive a transaction. |
| Frigate track | 17:04:53.946 onward | 1 cup track, top score 0.6943, in `handoff_zone` | A track is not a sale or delivery. |
| Automatic capture pair | 17:04:57.764 | 1 automatic JPEG/JSON pair; sender queue was `queued`, 0 attempts | The upload was not an AI decision or an order record. |
| Recovered recording scene | about 17:02:38 | No independent Frigate cup event or automatic capture | It must not be relabeled as an automatic capture. |

## Isolated Gemini Pro evaluation

The visual evaluation used `gemini-3.1-pro-preview` on three private still-image inputs. It used the configured normalized handoff polygon and recorded only normalized boxes, confidence, and visible-object results. No request went to an Ojala production endpoint or database.

| Input | Evidence origin | Person + cup + zone | Visible cups | Confidence | Classification limit |
|---|---|---:|---:|---|---|
| Replayed 17:02:38 frame | `recording_extracted_frame` | Yes | 1 | High | Recovery evidence only; manager review is mandatory. |
| Supplied 17:02:38 control | `recording_extracted_frame` | Yes | 1 | High | Control result supports the recovered-scene observation, not an automated historical event. |
| Automatic 17:04:57 capture | `automatic_frigate_capture` | Yes | 4 | High | Visible cups in one still do not prove four sales or deliveries. |

The repeated 17:02:38 result is useful because both a replayed frame and the supplied control independently yielded the same single-cup observation. The two files have different SHA-256 values and are retained as separate private evidence objects. The implementation preserves their origin rather than merging them into the automatic capture.

## Local persistence rehearsal

The recovered-scene result was persisted once to an isolated MariaDB instance bound only to `127.0.0.1:3317`. The rehearsal database was `ojala_real_case`; it was not preview or production. The normal Drizzle migration sequence was applied through migration `0017_visual_analysis_evidence.sql`, which adds only nullable `analysisEvidenceJson` audit storage.

The stored record remained `evidenceOrigin = recording_extracted_frame`, `aiSuggestedStatus = approved_by_ai`, and `analysisStatus = pending_review`. The model’s normalized person and cup boxes were persisted. The rehearsal added one visual evidence record and changed **zero** Frigate cup-count rows, end-of-day records, inventory rows, sales, deliveries, or revenue records.

> **Definition:** A `recording_extracted_frame` is evidence recovered after the original detector did not emit an independent automatic event. It can be offered to a manager for review but can never be treated as an automatic Frigate success.

## Measurable recovery proposal

The new Beelink-side `candidate_selector.py` creates a review candidate only when a **separate person signal** is in `handoff_zone` and meets the configured confidence threshold. It deduplicates candidates by a short scene bucket. It does not require a cup event, and it does not send a network request, create a count, or record a delivery.

Each selected candidate must still pass the existing gate: an extracted frame must show a person, a gelato cup, and the configured server-side zone. A candidate from recording is sent through the visual filter as `recording_extracted_frame`; even a positive AI suggestion remains `pending_review`. This preserves the current retry and deduplication design: `storeId + cameraName + cupEventId` continues to identify one evidence object, while the recovery-scene ID can never reuse the automatic event ID.

The proposal is intentionally conservative. It is ready for controlled measurement, not certified for deployment. The next evaluation must label all manually confirmed person-plus-cup-plus-zone scenes in retained footage, then compute candidate recall, manager-review precision, and false-candidate rate. The acceptance threshold must require no operational mutations and no increase in false positives before the detector configuration is changed.

## Verification status

The visual feature now makes the production model choice explicit: **Gemini 3.1 Pro** is scoped to the handoff filter. This does not change the application-wide default LLM helper. The feature includes a separate additive migration for persisted analysis boxes and model evidence.

| Check | Result |
|---|---|
| Private ZIP integrity | Pass |
| Offline replay of original recording | Pass |
| Gemini Pro evaluation of recovered and automatic evidence | Pass |
| Recovered evidence isolated from automatic capture | Pass |
| Local persistence retains manual-review status | Pass |
| Operational mutations in rehearsal | 0 |
| Root cause of the original missing cup event | Not established |
| Production modification | None |

## References

[1]: https://github.com/barrettmasso1/ojala-ops-dashboard/pull/10 "Ojala handoff scene recovery proposal"
[2]: https://github.com/barrettmasso1/ojala-ops-dashboard/pull/9 "Ojala isolated visual filter validation"
