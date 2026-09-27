# Offline recovery of a missed handoff scene

This package is a **measurement and review workflow** for a scene that the first Frigate detector did not independently turn into a `cup_event` or automatic snapshot. It is deliberately separate from the verified-snapshot sender.

> It does **not** connect to Ojala, does not read credentials, does not call an AI service, does not create sales/deliveries/cup counts, and does not make a recording-extracted frame look like an automatic Frigate success.

## What it accepts

Run only on a controlled Beelink/local workspace with:

- one local ZIP containing the original source recording for the selected window (exactly one `.mp4`, `.mkv`, `.mov`, or `.avi`), and optionally one embedded case manifest;
- a reviewed case manifest, such as `handoff-acceptance/ojala-2026-09-26-case.json`;
- `ffmpeg` installed locally.

Raw ZIPs, videos, extracted frames, and generated replay output are intentionally ignored by Git. Do **not** add customer imagery to GitHub.

## Ojala case — 26 September 2026

The included acceptance manifest records the provided facts without converting them into a conclusion:

| Measure | Observed / reference value | Meaning |
|---|---:|---|
| Operator reference | 2 medium cups | Human reference only; not size classification by Frigate/AI. |
| Frigate tracks | 1 `cup_event` | `1790467493.946143-9rdbpk`; distinct from sales. |
| Automatic capture pair | 1 at 17:04:57.764 local | Automatic capture; not a proof of all scenes. |
| Other recording scene | approx. 17:02:38 local | No independent event/capture; becomes a **recording-extracted candidate**, not automatic success. |

The root cause of the omission remains **unattributed** until the original ZIP is replayed with detector output/trace evidence. A later-extracted frame is never reported as an automatic capture.

## Safe replay

```bash
python3 replay_case.py \
  --archive /secure/local/ojala-2026-09-26-evidence.zip \
  --case ../../handoff-acceptance/ojala-2026-09-26-case.json \
  --output /secure/local/ojala-2026-09-26-replay
```

The output contains a single frame at the documented scene time and `replay-report.json` with:

- archive, source-recording, and extracted-frame SHA-256 checksums;
- the automatic Frigate observation and the extracted candidate as separate origins;
- no model boxes/confidences, no asserted discard cause, and no model review unless an explicitly isolated later analysis is run;
- explicit zeros for sales, deliveries, Frigate counts, inventory, and revenue writes.

Do not upload the source video/frame to a public repository or use the output with the normal Beelink sender.

## Measurable proposal after replay

1. A manager independently labels every person + gelato-cup + configured-handoff-zone scene in the original 10-minute window.
2. The replay report records candidate scene timestamps, frame SHA-256 values, detector boxes/confidences **only when present in original detector logs**, and the reason each candidate was rejected/retained.
3. A model may evaluate a selected frame in a **separate isolated run** using the configured zone geometry. A candidate can enter the app only through the manager-only `recording_extracted_frame` intake, where even an AI positive remains `pending_review` and stores the model suggestion separately.
4. Compare `candidate_recall`, `review_precision`, and `false_candidate_rate` defined in the acceptance manifest. The gate is maintained only when manual review shows that the recovery path adds qualified person + gelato-cup + zone candidates without increasing false candidates beyond the agreed threshold.
5. Any production change to first-stage Frigate detection requires a separate PR, source-video benchmark, and regression set. It must retain stable source IDs, retry/deduplication, and must never create operational counts from images.

No acceptance threshold is claimed by this package. The original evidence ZIP is required to calculate one.
