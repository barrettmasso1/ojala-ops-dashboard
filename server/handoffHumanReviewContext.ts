export type HandoffHumanReviewBrief = {
  sceneId: string;
  videoFile: string;
  localWindow: string;
  classification: "candidate_positive" | "pending_ambiguity";
  uncertaintyReason: string;
  duplicateGroup?: string;
  decisionPrompt: string;
};

/**
 * Manager-only context for the recovered 2026-10-14 handoff evidence.
 *
 * This intentionally lives server-side: the identifiers, review notes, and
 * video cross-references are returned only by the administrative queue route.
 * It does not create a count, sale, ounce value, or delivery.
 */
const REVIEW_DATE = "2026-10-14";
const reviewContextByEventId: Record<string, HandoffHumanReviewBrief> = {
  "rec-20261014-1792017255.187086-m7an23": {
    sceneId: "scene-01",
    videoFile: "scene-01.mp4",
    localWindow: "15:34:09–15:34:33 America/Mazatlan",
    classification: "candidate_positive",
    uncertaintyReason: "Recovered video shows one individual cup with a person at handoff, but recovered-video positives require a manager decision.",
    decisionPrompt: "Confirm or discard this visual-evidence item only. Do not create a daily cup count.",
  },
  "rec-20261014-1792018914.896338-co66t3": {
    sceneId: "scene-02",
    videoFile: "scene-02.mp4",
    localWindow: "16:01:53–16:03:03 America/Mazatlan",
    classification: "pending_ambiguity",
    uncertaintyReason: "Several counter objects are visible, but no individual gelato cup or handoff is isolated.",
    duplicateGroup: "scene-02-counter-group",
    decisionPrompt: "Keep pending unless the reviewer can identify one non-repeated gelato cup in the handoff zone.",
  },
  "rec-20261014-1792018930.596666-ry3res": {
    sceneId: "scene-02",
    videoFile: "scene-02.mp4",
    localWindow: "16:01:53–16:03:03 America/Mazatlan",
    classification: "pending_ambiguity",
    uncertaintyReason: "Same counter group as the other scene-02 records; an individual cup and transfer are not isolated.",
    duplicateGroup: "scene-02-counter-group",
    decisionPrompt: "Review together with the other scene-02 records; do not treat repeated stills as separate cups.",
  },
  "rec-20261014-1792018949.199366-n0girq": {
    sceneId: "scene-02",
    videoFile: "scene-02.mp4",
    localWindow: "16:01:53–16:03:03 America/Mazatlan",
    classification: "pending_ambiguity",
    uncertaintyReason: "Same counter group as the other scene-02 records; the video cannot isolate a single gelato cup in a confirmed handoff zone.",
    duplicateGroup: "scene-02-counter-group",
    decisionPrompt: "Review together with the other scene-02 records; do not treat repeated stills as separate cups.",
  },
  "rec-20261014-1792018968.991173-xqqwm3": {
    sceneId: "scene-02",
    videoFile: "scene-02.mp4",
    localWindow: "16:01:53–16:03:03 America/Mazatlan",
    classification: "pending_ambiguity",
    uncertaintyReason: "Same counter group as the other scene-02 records; the video cannot isolate a single gelato cup in a confirmed handoff zone.",
    duplicateGroup: "scene-02-counter-group",
    decisionPrompt: "Review together with the other scene-02 records; do not treat repeated stills as separate cups.",
  },
  "rec-20261014-1792019063.872012-j0becg": {
    sceneId: "scene-03",
    videoFile: "scene-03.mp4",
    localWindow: "16:04:15–16:05:03 America/Mazatlan",
    classification: "pending_ambiguity",
    uncertaintyReason: "A small container may be present, but resolution and occlusion do not confirm gelato or a handoff-zone transfer.",
    duplicateGroup: "scene-03-continuity",
    decisionPrompt: "Review the two scene-03 records as one continuity question, not two cups.",
  },
  "rec-20261014-1792019074.201183-2920zx": {
    sceneId: "scene-03",
    videoFile: "scene-03.mp4",
    localWindow: "16:04:15–16:05:03 America/Mazatlan",
    classification: "pending_ambiguity",
    uncertaintyReason: "The container appears already present after the earlier record; it may be the same object rather than a new handoff.",
    duplicateGroup: "scene-03-continuity",
    decisionPrompt: "Review the two scene-03 records as one continuity question, not two cups.",
  },
  "rec-20261014-1792022296.008487-a6nx4x": {
    sceneId: "scene-04",
    videoFile: "scene-04.mp4",
    localWindow: "16:58:09–16:59:45 America/Mazatlan",
    classification: "pending_ambiguity",
    uncertaintyReason: "Two plausible cups remain visible across a continuous scene, but source alerts cannot be assigned to individual unique cups.",
    duplicateGroup: "scene-04-continuous-two-cup-scene",
    decisionPrompt: "Review all scene-04 records together. Do not equate the five alerts with five cups.",
  },
  "rec-20261014-1792022295.591045-s6ajiz": {
    sceneId: "scene-04",
    videoFile: "scene-04.mp4",
    localWindow: "16:58:09–16:59:45 America/Mazatlan",
    classification: "pending_ambiguity",
    uncertaintyReason: "A second alert arrived 0.56 seconds from the preceding alert in the same continuous two-cup scene.",
    duplicateGroup: "scene-04-continuous-two-cup-scene",
    decisionPrompt: "Review all scene-04 records together. Do not equate the five alerts with five cups.",
  },
  "rec-20261014-1792022325.278651-5f1imu": {
    sceneId: "scene-04",
    videoFile: "scene-04.mp4",
    localWindow: "16:58:09–16:59:45 America/Mazatlan",
    classification: "pending_ambiguity",
    uncertaintyReason: "The same two cups remain visible in the continuous scene; this still is not an independent physical-cup observation.",
    duplicateGroup: "scene-04-continuous-two-cup-scene",
    decisionPrompt: "Review all scene-04 records together. Do not equate the five alerts with five cups.",
  },
  "rec-20261014-1792022355.117807-so2nvy": {
    sceneId: "scene-04",
    videoFile: "scene-04.mp4",
    localWindow: "16:58:09–16:59:45 America/Mazatlan",
    classification: "pending_ambiguity",
    uncertaintyReason: "The same two cups remain visible in the continuous scene; this still is not an independent physical-cup observation.",
    duplicateGroup: "scene-04-continuous-two-cup-scene",
    decisionPrompt: "Review all scene-04 records together. Do not equate the five alerts with five cups.",
  },
  "rec-20261014-1792022369.739024-3ut6s8": {
    sceneId: "scene-04",
    videoFile: "scene-04.mp4",
    localWindow: "16:58:09–16:59:45 America/Mazatlan",
    classification: "pending_ambiguity",
    uncertaintyReason: "The same two cups remain visible in the continuous scene; this still is not an independent physical-cup observation.",
    duplicateGroup: "scene-04-continuous-two-cup-scene",
    decisionPrompt: "Review all scene-04 records together. Do not equate the five alerts with five cups.",
  },
  "rec-20261014-1792025013.917396-9t059b": {
    sceneId: "scene-05",
    videoFile: "scene-05.mp4",
    localWindow: "17:43:26–17:43:50 America/Mazatlan",
    classification: "candidate_positive",
    uncertaintyReason: "A single cup is placed at the counter and then taken by a person. It remains recovered-video evidence requiring a manager decision.",
    decisionPrompt: "Confirm or discard this visual-evidence item only. Do not create a daily cup count.",
  },
  "rec-20261014-1792025116.525508-fd4dzz": {
    sceneId: "scene-06",
    videoFile: "scene-06.mp4",
    localWindow: "17:45:08–17:45:32 America/Mazatlan",
    classification: "candidate_positive",
    uncertaintyReason: "One cup is deposited and then picked up at the counter. It remains recovered-video evidence requiring a manager decision.",
    decisionPrompt: "Confirm or discard this visual-evidence item only. Do not create a daily cup count.",
  },
  "rec-20261014-1792026678.244999-8dslyd": {
    sceneId: "scene-07",
    videoFile: "scene-07.mp4",
    localWindow: "18:11:08–18:11:32 America/Mazatlan",
    classification: "pending_ambiguity",
    uncertaintyReason: "A cup-like object and person are visible, but the source scene does not independently corroborate the handoff-zone boundary.",
    decisionPrompt: "Keep pending unless a reviewer can confirm the configured handoff zone from the scene context.",
  },
  "rec-20261014-1792026717.54167-m1etak": {
    sceneId: "scene-08",
    videoFile: "scene-08.mp4",
    localWindow: "18:11:58–18:13:02 America/Mazatlan",
    classification: "candidate_positive",
    uncertaintyReason: "This is one persistent cup observed with the same person across three stills, not three cups.",
    duplicateGroup: "scene-08-one-persistent-cup",
    decisionPrompt: "If approved as evidence, group the three scene-08 records as one observation. Do not count it.",
  },
  "rec-20261014-1792026733.14603-a1mge8": {
    sceneId: "scene-08",
    videoFile: "scene-08.mp4",
    localWindow: "18:11:58–18:13:02 America/Mazatlan",
    classification: "candidate_positive",
    uncertaintyReason: "This is the same persistent cup as the earlier and later scene-08 records, not an additional cup.",
    duplicateGroup: "scene-08-one-persistent-cup",
    decisionPrompt: "If approved as evidence, group the three scene-08 records as one observation. Do not count it.",
  },
  "rec-20261014-1792026752.537352-jntcdl": {
    sceneId: "scene-08",
    videoFile: "scene-08.mp4",
    localWindow: "18:11:58–18:13:02 America/Mazatlan",
    classification: "candidate_positive",
    uncertaintyReason: "This is the same persistent cup as the earlier scene-08 records, not an additional cup.",
    duplicateGroup: "scene-08-one-persistent-cup",
    decisionPrompt: "If approved as evidence, group the three scene-08 records as one observation. Do not count it.",
  },
  "rec-20261014-1792026955.194441-thxfho": {
    sceneId: "scene-09",
    videoFile: "scene-09.mp4",
    localWindow: "18:15:46–18:16:10 America/Mazatlan",
    classification: "pending_ambiguity",
    uncertaintyReason: "The container could be another dessert or food; gelato identity and handoff-zone placement are not confirmed.",
    decisionPrompt: "Keep pending unless the reviewer can establish gelato identity and the handoff-zone location.",
  },
  "rec-20261014-1792027230.238408-n2yl2x": {
    sceneId: "scene-10",
    videoFile: "scene-10.mp4",
    localWindow: "18:20:22–18:21:13 America/Mazatlan",
    classification: "candidate_positive",
    uncertaintyReason: "This is one persistent cup with one person across two stills, not two cups. The AI-discarded status may be overridden only after manager review.",
    duplicateGroup: "scene-10-one-persistent-cup",
    decisionPrompt: "Treat both scene-10 records as one recovered visual observation, never as two cups or a count.",
  },
  "rec-20261014-1792027256.243379-d613yi": {
    sceneId: "scene-10",
    videoFile: "scene-10.mp4",
    localWindow: "18:20:22–18:21:13 America/Mazatlan",
    classification: "candidate_positive",
    uncertaintyReason: "This is the same persistent cup as the earlier scene-10 record, not an additional cup. The AI-discarded status may be overridden only after manager review.",
    duplicateGroup: "scene-10-one-persistent-cup",
    decisionPrompt: "Treat both scene-10 records as one recovered visual observation, never as two cups or a count.",
  },
  "rec-20261014-1792027673.148109-l11p6c": {
    sceneId: "scene-11",
    videoFile: "scene-11.mp4",
    localWindow: "18:27:57–18:28:40 America/Mazatlan",
    classification: "pending_ambiguity",
    uncertaintyReason: "The person is using a phone; stationary counter objects cannot be tied to a gelato cup or a handoff.",
    duplicateGroup: "scene-11-stationary-counter-objects",
    decisionPrompt: "Keep pending unless a reviewer can tie one unique gelato cup to a handoff interaction.",
  },
  "rec-20261014-1792027697.25089-45ljpd": {
    sceneId: "scene-11",
    videoFile: "scene-11.mp4",
    localWindow: "18:27:57–18:28:40 America/Mazatlan",
    classification: "pending_ambiguity",
    uncertaintyReason: "The same person and stationary counter objects appear again; this may repeat the earlier scene-11 observation.",
    duplicateGroup: "scene-11-stationary-counter-objects",
    decisionPrompt: "Keep pending unless a reviewer can tie one unique gelato cup to a handoff interaction.",
  },
  "rec-20261014-1792027781.273856-dc4j9q": {
    sceneId: "scene-12",
    videoFile: "scene-12.mp4",
    localWindow: "18:29:34–18:29:58 America/Mazatlan",
    classification: "pending_ambiguity",
    uncertaintyReason: "A person is present, but visible counter objects are stationary and no cup handoff is shown.",
    decisionPrompt: "Keep pending unless a reviewer can identify one unique gelato cup in the handoff zone.",
  },
  "rec-20261014-1792028133.705861-aard0j": {
    sceneId: "scene-13",
    videoFile: "scene-13.mp4",
    localWindow: "18:35:34–18:35:58 America/Mazatlan",
    classification: "pending_ambiguity",
    uncertaintyReason: "The person is using a phone and no individual gelato cup or transfer is visible.",
    decisionPrompt: "Keep pending unless a reviewer can identify one unique gelato cup in the handoff zone.",
  },
  "rec-20261014-1792030037.253162-ebaivp": {
    sceneId: "scene-14",
    videoFile: "scene-14.mp4",
    localWindow: "19:07:16–19:07:40 America/Mazatlan",
    classification: "pending_ambiguity",
    uncertaintyReason: "A person is behind the counter using a phone; visible objects cannot be identified or linked to a handoff.",
    decisionPrompt: "Keep pending unless a reviewer can identify one unique gelato cup and a handoff interaction.",
  },
  "rec-20261014-1792030447.258047-mccvqh": {
    sceneId: "scene-15",
    videoFile: "scene-15.mp4",
    localWindow: "19:13:58–19:15:16 America/Mazatlan",
    classification: "pending_ambiguity",
    uncertaintyReason: "This companion still is not an independent recovered-video positive; only the clearest middle candidate is proposed for review.",
    duplicateGroup: "scene-15-companion-stills",
    decisionPrompt: "Do not treat companion stills as additional cups. Review the clearest candidate in this scene instead.",
  },
  "rec-20261014-1792030477.252418-0fzscr": {
    sceneId: "scene-15",
    videoFile: "scene-15.mp4",
    localWindow: "19:13:58–19:15:16 America/Mazatlan",
    classification: "candidate_positive",
    uncertaintyReason: "The middle candidate visibly shows a physical cup handled at the counter with people present; it still requires a manager decision.",
    duplicateGroup: "scene-15-companion-stills",
    decisionPrompt: "Confirm or discard this visual-evidence item only. Do not use companion stills as additional cups or create a daily count.",
  },
  "rec-20261014-1792030493.555089-4fp6od": {
    sceneId: "scene-15",
    videoFile: "scene-15.mp4",
    localWindow: "19:13:58–19:15:16 America/Mazatlan",
    classification: "pending_ambiguity",
    uncertaintyReason: "This companion still is not an independent recovered-video positive; only the clearest middle candidate is proposed for review.",
    duplicateGroup: "scene-15-companion-stills",
    decisionPrompt: "Do not treat companion stills as additional cups. Review the clearest candidate in this scene instead.",
  },
};

export function getHandoffHumanReviewContext(input: {
  businessDate: string;
  cupEventId: string;
}): HandoffHumanReviewBrief | null {
  if (input.businessDate !== REVIEW_DATE) return null;
  return reviewContextByEventId[input.cupEventId] ?? null;
}

export function handoffHumanReviewContextCount() {
  return Object.keys(reviewContextByEventId).length;
}
